import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { parseResendBody } from "./schemas.ts";
import { countInternalAdminDeny, verifyInternalOperator } from "../_shared/internal-operator.ts";

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
  | "conflict"
  | "internal_error";

const ERROR_STATUS: Record<ErrorCode, number> = {
  method_not_allowed: 405,
  unauthenticated: 401,
  forbidden: 403,
  invalid_body: 400,
  not_found: 404,
  conflict: 409,
  internal_error: 500,
};

const ERROR_MESSAGES: Record<ErrorCode, string> = {
  method_not_allowed: "Método não suportado.",
  unauthenticated: "Sessão inválida ou expirada.",
  forbidden: "Você não tem permissão para reenviar este convite.",
  invalid_body: "Dados inválidos.",
  not_found: "Convite não encontrado.",
  conflict: "Convite já aceito; não é possível reenviar.",
  internal_error: "Não foi possível reenviar o convite. Tente novamente.",
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

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function generateToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

interface Identity {
  userId: string;
  tenantId: string | null;
  role: string;
  /** Valor CRU de `app_metadata.must_change_password`; `undefined` quando ausente. */
  mustChangePassword: unknown;
}

async function resolveIdentity(service: SupabaseClient, token: string): Promise<Identity | null> {
  const { data, error } = await service.auth.getUser(token);
  if (error || !data.user) return null;
  const { data: profile } = await service
    .from("profiles")
    .select("tenant_id, role")
    .eq("id", data.user.id)
    .maybeSingle();
  if (!profile) return null;
  const rawAppMetadata = (data.user as { app_metadata?: unknown }).app_metadata;
  const appMetadata: Record<string, unknown> =
    typeof rawAppMetadata === "object" && rawAppMetadata !== null
      ? (rawAppMetadata as Record<string, unknown>)
      : {};
  return {
    userId: data.user.id,
    tenantId: (profile.tenant_id as string | null) ?? null,
    role: profile.role as string,
    mustChangePassword: appMetadata.must_change_password,
  };
}

export type ResendInvitationHandlerOptions = { createService: () => SupabaseClient };

export function createResendInvitationHandler(options: ResendInvitationHandlerOptions) {
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

    let rawBody: unknown;
    try {
      rawBody = await req.json();
    } catch {
      return errorResponse("invalid_body");
    }
    const parsed = parseResendBody(rawBody);
    if (!parsed.ok) return errorResponse(parsed.code);
    const body = parsed.body;

    const { data: invitation, error: invErr } = await service
      .from("invitations")
      .select("*")
      .eq("id", body.invitation_id)
      .maybeSingle();
    if (invErr || !invitation) return errorResponse("not_found");

    const inv = invitation as Record<string, unknown>;
    const invTenantId = (inv.tenant_id as string | null) ?? null;

    // Caminho do operador interno (MIG-BE-02): prova server-side por request;
    // OK + sem must_change → ignora `profiles.role`, opera qualquer tenant.
    // must_change_password=true continua negando (403) com métrica de nega.
    try {
      await verifyInternalOperator(service, token);
      if (identity.mustChangePassword === true) {
        console.warn("resend-invitation: operator must_change_password blocked");
        await countInternalAdminDeny(service);
        return errorResponse("forbidden");
      }
      console.warn("resend-invitation: operator resend");
    } catch {
      if (identity.role === "super_admin") {
        if (invTenantId !== null) return errorResponse("forbidden");
      } else if (identity.role === "admin") {
        if (invTenantId !== identity.tenantId || identity.tenantId === null) return errorResponse("forbidden");
      } else {
        return errorResponse("forbidden");
      }
    }

    const allowedStatuses = new Set(["pending", "expired", "revoked"]);
    if (inv.status === "accepted") return errorResponse("conflict");
    if (!allowedStatuses.has(String(inv.status))) return errorResponse("conflict");

    const newToken = generateToken();
    const newHash = await sha256Hex(newToken);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

    const { error: updateErr } = await service
      .from("invitations")
      .update({
        token_hash: newHash,
        expires_at: expiresAt,
        status: "pending",
      })
      .eq("id", inv.id as string);
    if (updateErr) {
      console.error("resend-invitation: update failed", updateErr.code ?? "no-code");
      return errorResponse("internal_error");
    }

    const email = inv.email as string;
    const siteUrl = Deno.env.get("SITE_URL") ?? "";
    const redirectTo = `${siteUrl}/accept-invitation?token=${newToken}`;
    try {
      const admin = (service as { auth?: { admin?: { inviteUserByEmail?: (e: string, o: unknown) => Promise<unknown> } } }).auth?.admin;
      if (typeof admin?.inviteUserByEmail === "function") {
        await admin.inviteUserByEmail(email, { redirectTo });
      }
    } catch (err) {
      console.error("resend-invitation: inviteUserByEmail failed", err instanceof Error ? err.name : "erro");
    }

    const { error: auditErr } = await service.from("audit_log").insert({
      tenant_id: invTenantId,
      actor_id: identity.userId,
      action: "invitation.resent",
      target_type: "invitation",
      target_id: inv.id as string,
      metadata: {},
    });
    if (auditErr) {
      console.error("resend-invitation: audit insert failed", auditErr.code ?? "no-code");
      return errorResponse("internal_error");
    }

    return okResponse({ ok: true, expires_at: expiresAt });
  };
}
