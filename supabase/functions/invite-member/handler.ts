import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { parseInviteBody, type InviteBody } from "./schemas.ts";

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
  | "internal_error";

const ERROR_STATUS: Record<ErrorCode, number> = {
  method_not_allowed: 405,
  unauthenticated: 401,
  forbidden: 403,
  invalid_body: 400,
  internal_error: 500,
};

const ERROR_MESSAGES: Record<ErrorCode, string> = {
  method_not_allowed: "Método não suportado.",
  unauthenticated: "Sessão inválida ou expirada.",
  forbidden: "Você não tem permissão para convidar membros.",
  invalid_body: "Dados inválidos.",
  internal_error: "Não foi possível criar o convite. Tente novamente.",
};

function errorResponse(code: ErrorCode): Response {
  return new Response(JSON.stringify({ code, message: ERROR_MESSAGES[code] }), {
    status: ERROR_STATUS[code],
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function okResponse(body: unknown, status = 201): Response {
  return new Response(JSON.stringify(body), {
    status,
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

const TENANT_ADMIN_ROLES = new Set(["admin", "professional", "receptionist"]);

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
    .select("tenant_id, role")
    .eq("id", data.user.id)
    .maybeSingle();
  if (profileErr || !profile) return null;
  return {
    userId: data.user.id,
    tenantId: (profile.tenant_id as string | null) ?? null,
    role: profile.role as string,
  };
}

export type InviteMemberHandlerOptions = { createService: () => SupabaseClient };

export function createInviteMemberHandler(options: InviteMemberHandlerOptions) {
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
    const parsed = parseInviteBody(rawBody);
    if (!parsed.ok) return errorResponse(parsed.code);
    const body: InviteBody = parsed.body;

    // Permissões: super_admin convida super_admin; admin do tenant convida admin/professional/receptionist.
    let tenantId: string | null;
    if (identity.role === "super_admin") {
      if (body.role !== "super_admin") return errorResponse("forbidden");
      tenantId = null;
    } else if (identity.role === "admin") {
      if (!TENANT_ADMIN_ROLES.has(body.role)) return errorResponse("forbidden");
      if (identity.tenantId === null) return errorResponse("forbidden");
      tenantId = identity.tenantId;
    } else {
      return errorResponse("forbidden");
    }

    const inviteToken = generateToken();
    const tokenHash = await sha256Hex(inviteToken);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

    const { data: invitation, error: insertErr } = await service
      .from("invitations")
      .insert({
        tenant_id: tenantId,
        email: body.email,
        role: body.role,
        token_hash: tokenHash,
        status: "pending",
        expires_at: expiresAt,
        created_by: identity.userId,
      })
      .select("id")
      .single();

    if (insertErr || !invitation) {
      console.error("invite-member: insert failed", insertErr?.code ?? "no-code");
      return errorResponse("internal_error");
    }

    const { error: auditErr } = await service.from("audit_log").insert({
      tenant_id: tenantId,
      actor_id: identity.userId,
      action: "invitation.created",
      target_type: "invitation",
      target_id: invitation.id as string,
      metadata: { role: body.role },
    });
    if (auditErr) {
      console.error("invite-member: audit insert failed", auditErr.code ?? "no-code");
      return errorResponse("internal_error");
    }

    // Envio de e-mail best-effort; falha não desfaz o convite.
    const siteUrl = Deno.env.get("SITE_URL") ?? "";
    const redirectTo = `${siteUrl}/accept-invitation?token=${inviteToken}`;
    try {
      const admin = (service as { auth?: { admin?: { inviteUserByEmail?: (e: string, o: unknown) => Promise<unknown> } } }).auth?.admin;
      if (typeof admin?.inviteUserByEmail === "function") {
        await admin.inviteUserByEmail(body.email, { redirectTo });
      }
    } catch (err) {
      console.error("invite-member: inviteUserByEmail failed", err instanceof Error ? err.name : "erro");
    }

    return okResponse({ ok: true, invitation_id: invitation.id, expires_at: expiresAt });
  };
}
