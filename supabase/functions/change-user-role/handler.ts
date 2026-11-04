import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { parseChangeUserRoleBody } from "./schemas.ts";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type ErrorCode =
  | "method_not_allowed"
  | "unauthenticated"
  | "forbidden"
  | "invalid_body"
  | "not_found"
  | "last_admin"
  | "internal_error";

const ERROR_STATUS: Record<ErrorCode, number> = {
  method_not_allowed: 405,
  unauthenticated: 401,
  forbidden: 403,
  invalid_body: 400,
  not_found: 404,
  last_admin: 409,
  internal_error: 500,
};

const ERROR_MESSAGES: Record<ErrorCode, string> = {
  method_not_allowed: "Método não suportado.",
  unauthenticated: "Sessão inválida ou expirada.",
  forbidden: "Você não tem permissão para alterar o papel deste usuário.",
  invalid_body: "Dados inválidos.",
  not_found: "Usuário não encontrado.",
  last_admin: "Não é possível rebaixar o último administrador ativo.",
  internal_error: "Não foi possível alterar o papel. Tente novamente.",
};

function errorResponse(code: ErrorCode): Response {
  return new Response(JSON.stringify({ code, message: ERROR_MESSAGES[code] }), {
    status: ERROR_STATUS[code],
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function okResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function readBearerToken(req: Request): string {
  return (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
}

interface Identity {
  userId: string;
  tenantId: string | null;
  role: string;
}

async function resolveIdentity(service: SupabaseClient, token: string): Promise<Identity | null> {
  const { data, error } = await service.auth.getUser(token);
  if (error || !data.user) return null;
  const { data: profile, error: profileErr } = await service
    .from("profiles")
    .select("tenant_id, role, active")
    .eq("id", data.user.id)
    .maybeSingle();
  if (profileErr || !profile) return null;
  if (profile.active !== true) return null;
  return {
    userId: data.user.id,
    tenantId: (profile.tenant_id as string | null) ?? null,
    role: profile.role as string,
  };
}

export type ChangeUserRoleHandlerOptions = { createService: () => SupabaseClient };

export function createChangeUserRoleHandler(options: ChangeUserRoleHandlerOptions) {
  return async (req: Request): Promise<Response> => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
    if (req.method !== "POST") return errorResponse("method_not_allowed");

    let service: SupabaseClient;
    try {
      service = options.createService();
    } catch {
      return errorResponse("internal_error");
    }

    const token = readBearerToken(req);
    if (!token) return errorResponse("unauthenticated");
    const identity = await resolveIdentity(service, token);
    if (!identity) return errorResponse("unauthenticated");

    if (identity.role !== "admin" && identity.role !== "super_admin") {
      return errorResponse("forbidden");
    }

    let rawBody: unknown;
    try {
      rawBody = await req.json();
    } catch {
      return errorResponse("invalid_body");
    }
    const parsed = parseChangeUserRoleBody(rawBody);
    if (!parsed.ok) return errorResponse(parsed.code);
    const body = parsed.body;

    const { data: target, error: targetErr } = await service
      .from("profiles")
      .select("id, tenant_id, role, active")
      .eq("id", body.user_id)
      .maybeSingle();

    if (targetErr) return errorResponse("internal_error");
    if (!target) return errorResponse("not_found");

    const targetTenant = (target.tenant_id as string | null) ?? null;
    const oldRole = target.role as string;

    if (oldRole === "super_admin" && identity.role !== "super_admin") {
      return errorResponse("forbidden");
    }
    if (identity.role === "admin") {
      if (identity.tenantId === null || targetTenant !== identity.tenantId) {
        return errorResponse("forbidden");
      }
    }

    // Rejeitar mudança para o mesmo papel (no-op).
    if (body.new_role === oldRole) {
      return errorResponse("invalid_body");
    }

    // Last-admin guard: demoting an active admin.
    if (oldRole === "admin" && body.new_role !== "admin" && (target.active as boolean) && targetTenant !== null) {
      const { data: admins, error: adminsErr } = await service
        .from("profiles")
        .select("id")
        .eq("tenant_id", targetTenant)
        .eq("role", "admin")
        .eq("active", true);
      if (adminsErr) return errorResponse("internal_error");
      if ((admins ?? []).length <= 1) {
        return errorResponse("last_admin");
      }
    }

    const { error: updateErr } = await service
      .from("profiles")
      .update({
        role: body.new_role,
        role_changed_at: new Date().toISOString(),
        role_changed_by: identity.userId,
      })
      .eq("id", body.user_id);
    if (updateErr) {
      console.error("change-user-role: update failed", updateErr.code ?? "no-code");
      return errorResponse("internal_error");
    }

    const { error: auditErr } = await service.from("audit_log").insert({
      tenant_id: targetTenant,
      actor_id: identity.userId,
      action: "user.role_changed",
      target_type: "profile",
      target_id: body.user_id,
      metadata: { before: { role: oldRole }, after: { role: body.new_role } },
    });
    if (auditErr) {
      console.error("change-user-role: audit insert failed", auditErr.code ?? "no-code");
      return errorResponse("internal_error");
    }

    return okResponse({ ok: true });
  };
}