// Handler da Edge Function `admin-plan` — único caminho de escrita de tenants.plan.
// Molde: supabase/functions/admin-subscription/handler.ts (lógica injetável, sem segredo,
// respostas pt-BR, sem PII em log, ator do JWT, RBAC + flag de troca de senha antes de
// qualquer leitura/escrita do tenant alvo).

import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { z } from "npm:zod@3.23.8";
import { requestSchema, type SetPlanInput, type SetPlanResponse } from "./schemas.ts";
import { decidePlanGate, type PlanGateRole } from "./gate.ts";
import { requireInternalOperator } from "../_shared/identity.ts";
import { readVerifiedFactorsCount } from "../_shared/internal-operator.ts";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function errorResponse(message: string, status: number, extra?: Record<string, unknown>): Response {
  return jsonResponse({ error: message, ...extra }, status);
}

interface Identity {
  userId: string;
  tenantId: string | null;
  role: PlanGateRole;
  mustChangePassword: unknown;
}

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
  const rawAppMetadata = userData.user.app_metadata;
  const appMetadata: Record<string, unknown> =
    typeof rawAppMetadata === "object" && rawAppMetadata !== null
      ? (rawAppMetadata as Record<string, unknown>)
      : {};
  return {
    userId,
    tenantId: profile.tenant_id as string | null,
    role: profile.role as PlanGateRole,
    mustChangePassword: appMetadata.must_change_password,
  };
}

function mapRpcError(message: string): { status: number; body: Record<string, unknown> } {
  const combined = message ?? "";
  if (combined.includes("tenant_not_found")) {
    return { status: 404, body: { error: "Empresa não encontrada." } };
  }
  if (combined.includes("reason_too_short")) {
    return { status: 400, body: { error: "O motivo deve ter pelo menos 10 caracteres." } };
  }
  if (combined.includes("reason_too_long")) {
    return { status: 400, body: { error: "O motivo deve ter no máximo 280 caracteres." } };
  }
  if (combined.includes("same_plan")) {
    return { status: 409, body: { error: "A empresa já está neste plano." } };
  }
  if (combined.includes("PLAN_LIMIT")) {
    const detail = combined.split("PLAN_LIMIT:").pop()?.trim() ?? combined;
    return { status: 409, body: { error: detail, code: "PLAN_LIMIT" } };
  }
  if (combined.includes("invalid_plan")) {
    return { status: 400, body: { error: "Plano inválido." } };
  }
  return { status: 500, body: { error: "Não foi possível alterar o plano." } };
}

async function handleSetPlan(
  input: SetPlanInput,
  identity: Identity,
  service: SupabaseClient,
): Promise<Response> {
  // Gate de operador interno (BE-03): prova server-side por request, sem confiar em claim.
  // AAL real: `aal2` só quando a Auth Admin API lista ≥1 factor verificado NESTA
  // chamada (nunca literal fabricado). Qualquer falha nega fechado (operator_required).
  let operatorProof = false;
  let aal = "aal1";
  try {
    await requireInternalOperator(service, identity.userId);
    const verified = await readVerifiedFactorsCount(service, identity.userId);
    operatorProof = verified > 0;
    aal = verified > 0 ? "aal2" : "aal1";
  } catch {
    console.warn("set_plan: operator proof failed");
    operatorProof = false;
    aal = "aal1";
  }
  const decision = decidePlanGate({
    role: identity.role,
    mustChangePassword: identity.mustChangePassword,
    isOperator: operatorProof,
    aal,
  });
  if (!decision.allowed) {
    if (decision.code === "operator_required") {
      console.warn("set_plan: operator required", identity.role);
      return errorResponse("Você não tem permissão para alterar o plano.", 403);
    }
    if (decision.code === "forbidden_role") {
      console.warn("set_plan: forbidden role attempt", identity.role);
      return errorResponse("Você não tem permissão para alterar o plano.", 403);
    }
    const passwordMessage = "Troque sua senha antes de operar o painel.";
    return jsonResponse(
      { error: passwordMessage, code: "password_change_required", message: passwordMessage },
      403,
    );
  }

  const { tenantId, plan, reason, override } = input;

  const { data: tenant, error: tenantErr } = await service
    .from("tenants")
    .select("plan")
    .eq("id", tenantId)
    .maybeSingle();
  if (tenantErr) {
    console.error("set_plan: failed to load tenant", tenantErr.message);
    return errorResponse("Não foi possível carregar a empresa.", 500);
  }
  if (!tenant) {
    return errorResponse("Empresa não encontrada.", 404);
  }

  const { data: rpcData, error: rpcErr } = await service.rpc("admin_set_tenant_plan", {
    p_tenant_id: tenantId,
    p_new_plan: plan,
    p_changed_by: identity.userId,
    p_reason: reason,
    p_override: override ?? false,
  });

  if (rpcErr) {
    const mapped = mapRpcError(rpcErr.message ?? "");
    if (mapped.status >= 500) console.error("set_plan: rpc failed", rpcErr.message);
    return jsonResponse(mapped.body, mapped.status);
  }

  const row = Array.isArray(rpcData) ? rpcData[0] : rpcData;
  const body: SetPlanResponse = {
    ok: true,
    tenant_id: tenantId,
    old_plan: (row?.old_plan as SetPlanResponse["old_plan"]) ?? (tenant.plan as SetPlanResponse["old_plan"]),
    new_plan: (row?.new_plan as SetPlanResponse["new_plan"]) ?? plan,
  };
  return jsonResponse(body, 200);
}

export type AdminPlanHandlerOptions = {
  createService: () => SupabaseClient;
};

export function createAdminPlanHandler(
  options: AdminPlanHandlerOptions,
): (req: Request) => Promise<Response> {
  return async (req: Request): Promise<Response> => {
    if (req.method === "OPTIONS") {
      return new Response("ok", { headers: corsHeaders });
    }
    if (req.method !== "POST") {
      return errorResponse("Método não suportado.", 405);
    }
    try {
      let service: SupabaseClient;
      try {
        service = options.createService();
      } catch (err) {
        console.error("config", err instanceof Error ? err.message : "erro");
        return errorResponse("Erro de configuração do servidor.", 500);
      }
      const identity = await resolveIdentity(req, service);
      if (!identity) {
        return errorResponse("Sessão inválida ou expirada.", 401);
      }
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
      return await handleSetPlan(parsed.data, identity, service);
    } catch (err) {
      console.error("handler", err instanceof Error ? err.message : "erro inesperado");
      return errorResponse("Ocorreu um erro inesperado. Tente novamente.", 500);
    }
  };
}
