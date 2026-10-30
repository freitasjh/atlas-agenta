// Edge Function `admin-subscription` — SEGUNDA superfície privilegiada do projeto (ADR-03,
// Fatia 1 do Painel do Super Admin). É o ÚNICO caminho de escrita de `tenants.subscription_status`
// (o cliente perdeu o UPDATE dessas colunas na ADR-02). Concentra as invariantes caras num ponto
// testável:
//
//  - `role`/ator derivados do JWT/profiles NO SERVIDOR (nunca do payload — RNF03). Só super_admin
//    passa; qualquer outro papel recebe 403 (R-06).
//  - VALIDAÇÃO CANÔNICA da transição no servidor (§3.5 do PRD): a UI só espelha. Transição fora
//    da máquina → 409 com o par de→para no corpo (R-07, gate Q-04).
//  - PERSISTÊNCIA + AUDITORIA atômicas via a RPC `admin_set_subscription_status` (ADR-01): se a
//    trilha falhar, o status não muda (R-08). O `changed_by` é SEMPRE o userId do JWT (R-08/R-12).
//  - respostas JSON pt-BR; logs técnicos curtos em inglês, SEM PII (nunca documento/telefone/nome
//    do tenant).
//  - segredo (service role) só no env das Edge Functions, nunca no bundle do cliente (R-12).
//
// Molde: `supabase/functions/whatsapp/index.ts` (createServiceClient, resolveIdentity, CORS).

import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { z } from "npm:zod@3.23.8";
import {
  requestSchema,
  type SetStatusInput,
  type SetStatusResponse,
  type SubscriptionStatus,
} from "./schemas.ts";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

/** Resposta JSON pt-BR com status. */
function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function errorResponse(message: string, status: number, extra?: Record<string, unknown>): Response {
  return jsonResponse({ error: message, ...extra }, status);
}

/** Papel do usuário resolvido no servidor a partir de `profiles`. */
type RoleName = "super_admin" | "admin" | "professional" | "receptionist";

interface Identity {
  userId: string;
  tenantId: string | null;
  role: RoleName;
}

/**
 * Máquina de transições CANÔNICA de `subscription_status` (PRD §3.5, gate Q-03). Fonte da verdade
 * no servidor; a UI (ADR-07) só espelha escondendo destinos inválidos como defesa de usabilidade.
 * Nunca o mesmo status (no-op) e nunca voltar a `trial` (estado inicial, não destino operacional).
 */
const ALLOWED_TRANSITIONS: Record<SubscriptionStatus, readonly SubscriptionStatus[]> = {
  trial: ["ativo", "pendente", "cancelado"],
  ativo: ["pendente", "bloqueado", "cancelado"],
  pendente: ["ativo", "bloqueado", "cancelado"],
  bloqueado: ["ativo", "cancelado"],
  cancelado: ["ativo"],
};

function isTransitionAllowed(from: SubscriptionStatus, to: SubscriptionStatus): boolean {
  return ALLOWED_TRANSITIONS[from]?.includes(to) ?? false;
}

/** Cria o client com a service role (bypassa RLS) — só no servidor, nunca exposto ao cliente. */
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

/**
 * Resolve a identidade a partir do JWT do header Authorization. `auth.uid()` vem do token
 * validado pelo GoTrue; `tenant_id`/`role` são lidos de `profiles` com service role. NUNCA do
 * payload. Retorna null se o JWT for inválido/ausente.
 */
async function resolveIdentity(
  req: Request,
  service: SupabaseClient,
): Promise<Identity | null> {
  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token) return null;

  const { data: userData, error: userErr } = await service.auth.getUser(token);
  if (userErr || !userData.user) return null;

  const userId = userData.user.id;
  const { data: profile, error: profileErr } = await service
    .from("profiles")
    .select("tenant_id, role")
    .eq("id", userId)
    .maybeSingle();

  if (profileErr || !profile) return null;

  return {
    userId,
    tenantId: profile.tenant_id as string | null,
    role: profile.role as RoleName,
  };
}

// ---------------------------------------------------------------------------
// Operação: set_status
// ---------------------------------------------------------------------------
async function handleSetStatus(
  input: SetStatusInput,
  identity: Identity,
  service: SupabaseClient,
): Promise<Response> {
  // RBAC do caminho privilegiado: só super_admin opera status cross-tenant (R-06). O papel vem
  // do JWT/profiles, nunca do corpo.
  if (identity.role !== "super_admin") {
    console.warn("set_status: forbidden role attempt", identity.role);
    return errorResponse("Você não tem permissão para alterar o status de assinatura.", 403);
  }

  const { tenantId, status, reason } = input;

  // Carrega o status atual do tenant alvo (service role bypassa RLS). Ausente → 404.
  const { data: tenant, error: tenantErr } = await service
    .from("tenants")
    .select("subscription_status")
    .eq("id", tenantId)
    .maybeSingle();
  if (tenantErr) {
    console.error("set_status: failed to load tenant", tenantErr.message);
    return errorResponse("Não foi possível carregar a empresa.", 500);
  }
  if (!tenant) {
    return errorResponse("Empresa não encontrada.", 404);
  }

  const currentStatus = tenant.subscription_status as SubscriptionStatus;

  // Validação canônica da transição (§3.5). No-op (atual == destino) e transições fora da máquina
  // são recusadas com 409 e o par de→para no corpo (R-07, gate Q-04). A UI mantém o dialog aberto.
  if (!isTransitionAllowed(currentStatus, status)) {
    return errorResponse(
      "Transição de status não permitida.",
      409,
      { from: currentStatus, to: status },
    );
  }

  // Persiste + audita ATOMICAMENTE via a RPC (ADR-01). `p_changed_by` é SEMPRE o userId do JWT
  // (R-08/R-12), nunca do corpo. Se a trilha falhar, o status não muda.
  const { data: rpcData, error: rpcErr } = await service.rpc("admin_set_subscription_status", {
    p_tenant_id: tenantId,
    p_new_status: status,
    p_changed_by: identity.userId,
    p_reason: reason ?? null,
  });

  if (rpcErr) {
    // A RPC levanta `tenant_not_found` (SQLSTATE no_data_found) quando a linha some entre o SELECT
    // e o FOR UPDATE — trata como 404; demais erros → 500 pt-BR.
    const combined = `${rpcErr.message ?? ""} ${rpcErr.code ?? ""}`;
    if (combined.includes("tenant_not_found") || rpcErr.code === "P0002") {
      return errorResponse("Empresa não encontrada.", 404);
    }
    console.error("set_status: rpc failed", rpcErr.message);
    return errorResponse("Não foi possível alterar o status da assinatura.", 500);
  }

  // A RPC retorna uma linha `(old_status, new_status)`.
  const row = Array.isArray(rpcData) ? rpcData[0] : rpcData;
  const oldStatus = (row?.old_status as SubscriptionStatus | undefined) ?? currentStatus;
  const newStatus = (row?.new_status as SubscriptionStatus | undefined) ?? status;

  const body: SetStatusResponse = {
    ok: true,
    tenant_id: tenantId,
    old_status: oldStatus,
    new_status: newStatus,
  };
  return jsonResponse(body, 200);
}

// ---------------------------------------------------------------------------
// Entrypoint HTTP
// ---------------------------------------------------------------------------
Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return errorResponse("Método não suportado.", 405);
  }

  let service: SupabaseClient;
  try {
    service = createServiceClient();
  } catch (err) {
    console.error("config", err instanceof Error ? err.message : "erro");
    return errorResponse("Erro de configuração do servidor.", 500);
  }

  // Autenticação: JWT obrigatório; role/ator derivados no servidor.
  const identity = await resolveIdentity(req, service);
  if (!identity) {
    return errorResponse("Sessão inválida ou expirada.", 401);
  }

  // Parse + validação do payload (dado não confiável).
  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return errorResponse("Corpo da requisição inválido.", 400);
  }

  const parsed = requestSchema.safeParse(rawBody);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i: z.ZodIssue) => i.message);
    return errorResponse("Dados inválidos.", 400, { issues });
  }

  try {
    return await handleSetStatus(parsed.data, identity, service);
  } catch (err) {
    console.error("handler", err instanceof Error ? err.message : "erro inesperado");
    return errorResponse("Ocorreu um erro inesperado. Tente novamente.", 500);
  }
});
