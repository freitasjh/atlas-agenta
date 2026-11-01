import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { parseAcceptBody } from "./schemas.ts";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type ErrorCode =
  | "method_not_allowed"
  | "invalid_body"
  | "invalid_or_expired"
  | "revoked"
  | "internal_error";

const ERROR_STATUS: Record<ErrorCode, number> = {
  method_not_allowed: 405,
  invalid_body: 400,
  invalid_or_expired: 410,
  revoked: 410,
  internal_error: 500,
};

const ERROR_MESSAGES: Record<ErrorCode, string> = {
  method_not_allowed: "Método não suportado.",
  invalid_body: "Dados inválidos.",
  invalid_or_expired: "Convite inválido ou expirado.",
  revoked: "Convite revogado.",
  internal_error: "Não foi possível aceitar o convite. Tente novamente.",
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

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function randomPassword(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}

export type AcceptInvitationHandlerOptions = { createService: () => SupabaseClient };

export function createAcceptInvitationHandler(options: AcceptInvitationHandlerOptions) {
  return async (req: Request): Promise<Response> => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
    if (req.method !== "POST") return errorResponse("method_not_allowed");

    let service: SupabaseClient;
    try {
      service = options.createService();
    } catch {
      return errorResponse("internal_error");
    }

    let rawBody: unknown;
    try {
      rawBody = await req.json();
    } catch {
      return errorResponse("invalid_body");
    }
    const parsed = parseAcceptBody(rawBody);
    if (!parsed.ok) return errorResponse(parsed.code);
    const body = parsed.body;

    const tokenHash = await sha256Hex(body.token);

    const { data: invitation, error: invErr } = await service
      .from("invitations")
      .select("*")
      .eq("token_hash", tokenHash)
      .maybeSingle();

    if (invErr || !invitation) return errorResponse("invalid_or_expired");

    const inv = invitation as Record<string, unknown>;
    const status = inv.status as string;
    if (status === "revoked") return errorResponse("revoked");
    if (status === "expired") return errorResponse("invalid_or_expired");
    if (status === "accepted") return okResponse({ ok: true });

    const expiresAt = new Date(inv.expires_at as string).getTime();
    if (!Number.isFinite(expiresAt) || expiresAt < Date.now()) {
      await service
        .from("invitations")
        .update({ status: "expired" })
        .eq("id", inv.id as string);
      return errorResponse("invalid_or_expired");
    }

    const email = inv.email as string;
    const role = inv.role as string;
    const tenantId = (inv.tenant_id as string | null) ?? null;

    // Encontra ou cria o usuário no Auth.
    let userId: string | null = null;
    try {
      const admin = (service as { auth?: { admin?: { getUserByEmail?: (e: string) => Promise<{ data?: { user?: { id: string } }; error?: unknown }>; createUser?: (a: unknown) => Promise<{ data?: { user?: { id: string } }; error?: unknown }> } } }).auth?.admin;
      if (typeof admin?.getUserByEmail === "function") {
        const { data } = await admin.getUserByEmail(email);
        userId = data?.user?.id ?? null;
      }
      if (!userId && typeof admin?.createUser === "function") {
        const password = body.password ?? randomPassword();
        const { data } = await admin.createUser({
          email,
          password,
          email_confirm: true,
        });
        userId = data?.user?.id ?? null;
      }
    } catch (err) {
      console.error("accept-invitation: user resolution failed", err instanceof Error ? err.name : "erro");
    }

    if (!userId) return errorResponse("internal_error");

    const { error: profileErr } = await service.from("profiles").upsert(
      {
        id: userId,
        tenant_id: tenantId,
        role,
      },
      { onConflict: "id" },
    );
    if (profileErr) {
      console.error("accept-invitation: profile upsert failed", (profileErr as { code?: string }).code ?? "no-code");
      return errorResponse("internal_error");
    }

    await service
      .from("invitations")
      .update({ status: "accepted", accepted_at: new Date().toISOString(), accepted_user_id: userId })
      .eq("id", inv.id as string);

    await service.from("audit_log").insert({
      tenant_id: tenantId,
      actor_id: userId,
      action: "invitation.accepted",
      target_type: "invitation",
      target_id: inv.id as string,
      metadata: { role },
    });

    return okResponse({ ok: true });
  };
}
