// Edge Function `signup-tenant` — ADR-02 (RQ-19, cadastro de empresa sem regra de papel em trigger).
//
// Cria o usuário no Auth e, em seguida, a empresa + profile admin + 5 templates pela RPC
// `create_tenant_with_admin`, numa transação só. Se a RPC falha, o usuário Auth recém-criado é
// removido, e nenhuma empresa fica parcial. A função é pública (`verify_jwt = false` em config.toml)
// porque é o próprio cadastro: quem chama ainda não tem sessão.
//
// Garantias:
//   - o corpo é validado com zod e `.strict()` (schemas.ts) antes de qualquer escrita;
//   - o usuário Auth nasce sem `app_metadata` de papel. O papel `admin` vem da RPC, no servidor;
//   - a service role fica só no env desta função, nunca no cliente;
//   - respostas de erro `{ code, message }` com mensagem pt-BR estável. Logs técnicos curtos, sem
//     senha, e-mail, telefone nem nome.
//
// Molde: `supabase/functions/change-password/index.ts` (CORS, service client, erro padronizado).
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { parseSignupBody, type SignupBody, type SignupBodyErrorCode } from "./schemas.ts";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type ErrorCode =
  | "method_not_allowed"
  | "email_ja_cadastrado"
  | "cadastro_falhou"
  | "internal_error"
  | SignupBodyErrorCode;

const ERROR_STATUS: Record<ErrorCode, number> = {
  method_not_allowed: 405,
  invalid_body: 400,
  password_too_short: 400,
  password_too_long: 400,
  email_ja_cadastrado: 409,
  cadastro_falhou: 500,
  internal_error: 500,
};

const ERROR_MESSAGES: Record<ErrorCode, string> = {
  method_not_allowed: "Método não suportado.",
  invalid_body: "Dados inválidos.",
  password_too_short: "A senha deve ter no mínimo 8 caracteres.",
  password_too_long: "A senha deve ter no máximo 72 bytes.",
  email_ja_cadastrado: "Este e-mail já tem cadastro.",
  cadastro_falhou: "Não foi possível criar sua conta. Tente novamente.",
  internal_error: "Não foi possível criar sua conta. Tente novamente.",
};

/** Resposta de erro padronizada `{ code, message }`, com status do código. */
function errorResponse(code: ErrorCode): Response {
  return new Response(JSON.stringify({ code, message: ERROR_MESSAGES[code] }), {
    status: ERROR_STATUS[code],
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/** Client com a service role (bypassa RLS). Só no servidor, nunca exposto ao cliente. */
function createServiceClient(): SupabaseClient {
  const url = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceRoleKey) {
    throw new Error("Configuração do servidor ausente (SUPABASE_URL/SERVICE_ROLE_KEY).");
  }
  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** E-mail já existente no Auth. O GoTrue devolve `email_exists` (ou `user_already_exists`). */
function isEmailTaken(error: { code?: string; status?: number; message?: string }): boolean {
  if (error.code === "email_exists" || error.code === "user_already_exists") return true;
  // Fallback para versões do GoTrue que só informam o texto do erro com status 422.
  return error.status === 422 && /already/i.test(error.message ?? "");
}

/**
 * Cria a empresa com o admin pela RPC. Se a RPC falha, remove o usuário Auth recém-criado para não
 * deixar login sem empresa. Falha ao remover só vai para o log: o registro fica para limpeza manual.
 */
async function createTenantForUser(
  userId: string,
  body: SignupBody,
  service: SupabaseClient,
): Promise<Response> {
  const { error: rpcErr } = await service.rpc("create_tenant_with_admin", {
    p_user_id: userId,
    p_owner_email: body.email,
    p_trade_name: body.trade_name,
    p_full_name: body.full_name ?? null,
    p_segment: body.segment ?? null,
  });
  if (rpcErr) {
    console.error("signup-tenant: create_tenant_with_admin failed", rpcErr.code ?? "no-code");
    const { error: deleteErr } = await service.auth.admin.deleteUser(userId);
    if (deleteErr) {
      console.error("signup-tenant: rollback deleteUser failed", deleteErr.status ?? "no-status");
    }
    return errorResponse("cadastro_falhou");
  }
  return new Response(JSON.stringify({ ok: true }), {
    status: 201,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return errorResponse("method_not_allowed");
  }

  try {
    let service: SupabaseClient;
    try {
      service = createServiceClient();
    } catch (err) {
      console.error("config", err instanceof Error ? err.message : "erro");
      return errorResponse("internal_error");
    }

    // 1. Corpo validado antes de qualquer escrita.
    let rawBody: unknown;
    try {
      rawBody = await req.json();
    } catch {
      return errorResponse("invalid_body");
    }
    const parsed = parseSignupBody(rawBody);
    if (!parsed.ok) {
      return errorResponse(parsed.code);
    }
    const body = parsed.body;

    // 2. Usuário Auth já confirmado (a confirmação de e-mail está desligada no MVP, Q2).
    //    Sem `app_metadata` de papel: o papel é definido pela RPC, no servidor.
    const { data: created, error: createErr } = await service.auth.admin.createUser({
      email: body.email,
      password: body.password,
      email_confirm: true,
    });
    if (createErr) {
      if (isEmailTaken(createErr)) {
        return errorResponse("email_ja_cadastrado");
      }
      console.error("signup-tenant: createUser failed", createErr.status ?? "no-status");
      return errorResponse("cadastro_falhou");
    }
    if (!created.user) {
      console.error("signup-tenant: createUser returned no user");
      return errorResponse("cadastro_falhou");
    }

    // 3. Empresa + profile admin + templates, numa transação na RPC.
    return await createTenantForUser(created.user.id, body, service);
  } catch (err) {
    console.error("handler", err instanceof Error ? err.message : "erro inesperado");
    return errorResponse("internal_error");
  }
});
