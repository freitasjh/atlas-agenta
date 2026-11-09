// Handler do hook `custom_access_token` — ADR-01 (hook do GoTrue).
//
// O GoTrue chama esta função a cada emissão e renovação de token. Ela adiciona ao access token as
// claims `user_role`, `tenant_id` e `must_change_password`. NUNCA emite nem sobrescreve `role`:
// `role` é o papel Postgres (`authenticated`) que o PostgREST usa para o RLS.
//
// Ordem rígida, nenhum efeito antes dos passos anteriores:
//   1. método POST;
//   2. AUTENTICIDADE: assinatura Standard Webhooks (`webhook-id`, `webhook-timestamp`,
//      `webhook-signature`) validada com `CUSTOM_ACCESS_TOKEN_HOOK_SECRET`, sobre o corpo cru.
//      Sem assinatura válida → 401. A validação usa HMAC do WebCrypto, que compara em tempo
//      constante;
//   3. corpo validado com zod (schemas.ts) → 400 `invalid_body`;
//   4. leitura de `profiles` com service role, filtrada por `user_id` do corpo já validado.
//      Erro de leitura ou perfil inválido → 500 `identity_unavailable`: o login falha (fail closed);
//      super_admin sem operador ativo + factor MFA verificado → 200 com claims neutras
//      + `mfa_required` (rebaixado, sem privilégio; autorização em verify-operator/RLS);
//   5. claims montadas (schemas.ts) → 200 `{ claims }`.
//
// Esta função é pública no sentido do GoTrue (`verify_jwt = false` em config.toml), por isso a
// autenticidade é a assinatura do hook. Segredos vivem só em env (nunca no bundle nem em logs).
// Logs técnicos só com códigos de erro: sem e-mail, telefone, id de usuário nem token.
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";
import {
  buildHookClaims,
  hookInputSchema,
  profileRowSchema,
  type ProfileRow,
} from "./schemas.ts";
import { isActiveInternalOperator, readVerifiedFactorsCount } from "../_shared/internal-operator.ts";

const HOOK_SECRET_ENV = "CUSTOM_ACCESS_TOKEN_HOOK_SECRET";

/** Janela de aceitação do timestamp da assinatura (segundos), conforme Standard Webhooks. */
const TIMESTAMP_TOLERANCE_SECONDS = 300;

const jsonHeaders: Record<string, string> = { "Content-Type": "application/json" };

type ErrorCode = "method_not_allowed" | "unauthorized" | "invalid_body" | "identity_unavailable";

const ERROR_BODY: Record<ErrorCode, { status: number; message: string }> = {
  method_not_allowed: { status: 405, message: "Método não suportado." },
  unauthorized: { status: 401, message: "Assinatura do hook inválida." },
  invalid_body: { status: 400, message: "Corpo do hook inválido." },
  identity_unavailable: { status: 500, message: "Não foi possível montar a identidade da sessão." },
};

function errorResponse(code: ErrorCode): Response {
  const { status, message } = ERROR_BODY[code];
  return new Response(JSON.stringify({ code, message }), { status, headers: jsonHeaders });
}

/**
 * Decodifica a chave do hook. O segredo tem o formato `v1,whsec_<base64>` (ou só `whsec_<base64>`).
 * Lança erro se o base64 for inválido: o chamador trata como falha de configuração.
 */
function base64ToBytes(encoded: string): Uint8Array<ArrayBuffer> {
  const binary = atob(encoded);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function decodeHookKey(secret: string): Uint8Array<ArrayBuffer> {
  return base64ToBytes(secret.trim().replace(/^v1,/, "").replace(/^whsec_/, ""));
}

/**
 * Valida a assinatura Standard Webhooks do corpo cru. O conteúdo assinado é
 * `${webhook-id}.${webhook-timestamp}.${corpo}`. O cabeçalho pode trazer várias assinaturas
 * separadas por espaço (`v1,<base64>`); basta uma válida.
 */
async function verifyWebhookSignature(
  req: Request,
  rawBody: string,
  secret: string,
): Promise<boolean> {
  const messageId = req.headers.get("webhook-id");
  const timestamp = req.headers.get("webhook-timestamp");
  const signatureHeader = req.headers.get("webhook-signature");
  if (!messageId || !timestamp || !signatureHeader) return false;
  if (!/^\d+$/.test(timestamp)) return false;

  const ageSeconds = Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp));
  if (ageSeconds > TIMESTAMP_TOLERANCE_SECONDS) return false;

  const key = await crypto.subtle.importKey(
    "raw",
    decodeHookKey(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const signedContent = new TextEncoder().encode(`${messageId}.${timestamp}.${rawBody}`);

  for (const candidate of signatureHeader.split(" ")) {
    const [version, encoded] = candidate.split(",");
    if (version !== "v1" || !encoded) continue;
    let signature: Uint8Array<ArrayBuffer>;
    try {
      signature = base64ToBytes(encoded);
    } catch {
      continue;
    }
    if (await crypto.subtle.verify("HMAC", key, signature, signedContent)) return true;
  }
  return false;
}

/** Client com service role (bypassa RLS). Só no servidor, nunca exposto ao cliente. */
function createServiceClient(): SupabaseClient {
  const url = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceRoleKey) {
    throw new Error("config: SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY ausente");
  }
  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export interface HandleHookOptions {
  /** Client de serviço injetado (testes). Default: criado a partir do env. */
  serviceClient?: SupabaseClient;
}

export async function handleHookRequest(
  req: Request,
  options?: HandleHookOptions,
): Promise<Response> {
  if (req.method !== "POST") {
    return errorResponse("method_not_allowed");
  }

  try {
    const secret = Deno.env.get(HOOK_SECRET_ENV);
    if (!secret) {
      console.error("custom-access-token: config missing hook secret");
      return errorResponse("identity_unavailable");
    }

    // 1. Autenticidade sobre o corpo cru, antes de qualquer leitura.
    const rawBody = await req.text();
    let authentic: boolean;
    try {
      authentic = await verifyWebhookSignature(req, rawBody, secret);
    } catch {
      console.error("custom-access-token: config invalid hook secret");
      return errorResponse("identity_unavailable");
    }
    if (!authentic) {
      return errorResponse("unauthorized");
    }

    // 2. Corpo validado com zod (dado não confiável).
    let json: unknown;
    try {
      json = JSON.parse(rawBody);
    } catch {
      return errorResponse("invalid_body");
    }
    const input = hookInputSchema.safeParse(json);
    if (!input.success) {
      return errorResponse("invalid_body");
    }

    // 3. Papel e tenant vêm de `profiles` (fonte da verdade), com service role.
    let service: SupabaseClient;
    if (options?.serviceClient) {
      service = options.serviceClient;
    } else {
      try {
        service = createServiceClient();
      } catch {
        console.error("custom-access-token: config missing supabase env");
        return errorResponse("identity_unavailable");
      }
    }

    const { data, error } = await service
      .from("profiles")
      .select("role, tenant_id, active")
      .eq("id", input.data.user_id)
      .maybeSingle();

    if (error) {
      console.error("custom-access-token: profiles read failed", error.code ?? "unknown");
      return errorResponse("identity_unavailable");
    }

    let profile: ProfileRow | null = null;
    if (data) {
      const parsedProfile = profileRowSchema.safeParse(data);
      if (!parsedProfile.success) {
        console.error("custom-access-token: profile shape invalid");
        return errorResponse("identity_unavailable");
      }
      profile = parsedProfile.data;
    }

    // ADR-003 (convite): o GoTrue chama este hook durante a verificação do token de
    // convite, antes de `accept-invitation` criar o profile. Perfil ausente não é erro:
    // emitimos claims mínimas (user_role=null, tenant_id=null, active=false) com 200.
    // Fail-closed permanece para erro de leitura do banco (error !== null) e shape inválido,
    // tratados acima (500 identity_unavailable).

    // 4. Gate de operador interno (BE-03 + bugfix auth-hook-mfa-lockout): super_admin
    // só recebe claims com privilégio quando há registro ativo em internal_operators
    // + factor MFA verificado (enrollment, server-side via Admin API, nunca claim do
    // cliente). Sem operador ou sem factor verificado, o hook REBAIXA para 200 com
    // claims neutras (sem privilégio super_admin) + flag `mfa_required`: a autenticação
    // (aal1) abre para permitir o enroll de MFA, mas a autorização segue fechada em
    // verify-operator/guards/RLS. Erro real de leitura falha fechado (500
    // identity_unavailable). RLS usa `current_role_name()`, que lê `profiles` direto
    // (nunca claims): claims neutras nunca concedem cross-tenant (BOLA segue fechado).
    if (profile && profile.role === "super_admin") {
      let operator = false;
      let verified = 0;
      try {
        operator = await isActiveInternalOperator(service, input.data.user_id);
        verified = operator
          ? await readVerifiedFactorsCount(service, input.data.user_id)
          : 0;
      } catch {
        console.error("custom-access-token: operator check failed");
        return errorResponse("identity_unavailable");
      }
      if (!operator || verified <= 0) {
        console.error("custom-access-token: super_admin without operator+aal2 downgraded");
        const downgraded = buildHookClaims(input.data.claims, null);
        if (!downgraded.ok) {
          console.error("custom-access-token: app_metadata flag invalid");
          return errorResponse("identity_unavailable");
        }
        return new Response(
          JSON.stringify({ claims: { ...downgraded.claims, mfa_required: true } }),
          { status: 200, headers: jsonHeaders },
        );
      }
    }

    // 4. Monta as claims. Flag inválida também falha fechada.
    const built = buildHookClaims(input.data.claims, profile);
    if (!built.ok) {
      console.error("custom-access-token: app_metadata flag invalid");
      return errorResponse("identity_unavailable");
    }

    return new Response(JSON.stringify({ claims: built.claims }), {
      status: 200,
      headers: jsonHeaders,
    });
  } catch (err) {
    console.error("custom-access-token: handler", err instanceof Error ? err.message : "erro");
    return errorResponse("identity_unavailable");
  }
}
