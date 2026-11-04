import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { parseUnlinkProfessionalProfileBody } from "./schemas.ts";

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
  | "internal_error";

const ERROR_STATUS: Record<ErrorCode, number> = {
  method_not_allowed: 405,
  unauthenticated: 401,
  forbidden: 403,
  invalid_body: 400,
  not_found: 404,
  internal_error: 500,
};

const ERROR_MESSAGES: Record<ErrorCode, string> = {
  method_not_allowed: "Método não suportado.",
  unauthenticated: "Sessão inválida ou expirada.",
  forbidden: "Você não tem permissão para desvincular este profissional.",
  invalid_body: "Dados inválidos.",
  not_found: "Profissional não encontrado.",
  internal_error: "Não foi possível desvincular. Tente novamente.",
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

export type UnlinkProfessionalProfileHandlerOptions = { createService: () => SupabaseClient };

export function createUnlinkProfessionalProfileHandler(options: UnlinkProfessionalProfileHandlerOptions) {
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
    const parsed = parseUnlinkProfessionalProfileBody(rawBody);
    if (!parsed.ok) return errorResponse(parsed.code);
    const body = parsed.body;

    const { data: professional, error: profErr } = await service
      .from("professionals")
      .select("id, tenant_id, profile_id")
      .eq("id", body.professional_id)
      .maybeSingle();

    if (profErr) return errorResponse("internal_error");
    if (!professional) return errorResponse("not_found");

    const profTenant = (professional.tenant_id as string | null) ?? null;
    const previousProfileId = (professional.profile_id as string | null) ?? null;

    if (identity.role === "admin") {
      if (identity.tenantId === null || profTenant !== identity.tenantId) {
        return errorResponse("forbidden");
      }
    }

    let updateQuery = service
      .from("professionals")
      .update({ profile_id: null })
      .eq("id", body.professional_id);
    if (profTenant) {
      updateQuery = updateQuery.eq("tenant_id", profTenant);
    }
    const { error: updateErr } = await updateQuery;
    if (updateErr) {
      console.error("unlink-professional-profile: update failed", updateErr.code ?? "no-code");
      return errorResponse("internal_error");
    }

    const { error: auditErr } = await service.from("audit_log").insert({
      tenant_id: profTenant,
      actor_id: identity.userId,
      action: "professional.unlinked",
      target_type: "professional",
      target_id: body.professional_id,
      metadata: { profile_id: previousProfileId },
    });
    if (auditErr) {
      console.error("unlink-professional-profile: audit insert failed", auditErr.code ?? "no-code");
      return errorResponse("internal_error");
    }

    return okResponse({ ok: true });
  };
}