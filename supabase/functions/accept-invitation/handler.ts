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
  | "tenant_conflict"
  | "internal_error";

const ERROR_STATUS: Record<ErrorCode, number> = {
  method_not_allowed: 405,
  invalid_body: 400,
  invalid_or_expired: 410,
  revoked: 410,
  tenant_conflict: 409,
  internal_error: 500,
};

const ERROR_MESSAGES: Record<ErrorCode, string> = {
  method_not_allowed: "Método não suportado.",
  invalid_body: "Dados inválidos.",
  invalid_or_expired: "Convite inválido ou expirado.",
  revoked: "Convite revogado.",
  tenant_conflict: "Este e-mail já pertence a outra empresa.",
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

type AuthAdminLike = {
  listUsers?: (params: {
    page: number;
    perPage: number;
  }) => Promise<{
    data?: { users?: Array<{ id: string; email?: string | null }>; nextPage?: number | null };
    error?: unknown;
  }>;
  createUser?: (a: unknown) => Promise<{ data?: { user?: { id: string } }; error?: unknown }>;
  updateUserById?: (
    id: string,
    attrs: unknown,
  ) => Promise<{ data?: { user?: { id: string } }; error?: unknown }>;
};

function extractAdmin(service: SupabaseClient): AuthAdminLike | undefined {
  return (service as { auth?: { admin?: AuthAdminLike } }).auth?.admin;
}

/**
 * Localiza o id do usuário no Auth pelo e-mail (case-insensitive),
 * paginando a Admin API. `getUserByEmail` não existe no supabase-js
 * via JSR no edge runtime — por isso o lookup usa `listUsers`.
 * Retorna `null` quando não existe ou quando o lookup falha.
 */
async function findUserIdByEmail(
  admin: AuthAdminLike | undefined,
  email: string,
): Promise<string | null> {
  if (typeof admin?.listUsers !== "function") return null;
  const target = email.toLowerCase();
  for (let page = 1; page <= 10; page += 1) {
    const { data, error } = await admin.listUsers({ page, perPage: 200 });
    if (error) {
      console.error("accept-invitation: listUsers failed", {
        code: (error as { code?: string }).code ?? "no-code",
        message: (error as { message?: string }).message ?? "no-message",
      });
      return null;
    }
    const users = data?.users ?? [];
    const found = users.find((u) => (u.email ?? "").toLowerCase() === target);
    if (found) return found.id;
    if (users.length < 200 || data?.nextPage == null) return null;
  }
  return null;
}

function isEmailExistsError(error: unknown): boolean {
  const err = error as { code?: string; message?: string; status?: number } | null;
  if (!err) return false;
  if (err.code === "email_exists" || err.code === "user_already_exists") return true;
  const haystack = `${err.code ?? ""} ${err.message ?? ""}`;
  if (/already|exists/i.test(haystack)) return true;
  return err.status === 422 && /already|exists/i.test(err.message ?? "");
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
      .select("id, tenant_id, email, role, status, expires_at, professional_id, accepted_user_id, token_hash")
      .eq("token_hash", tokenHash)
      .maybeSingle();

    if (invErr || !invitation) return errorResponse("invalid_or_expired");

    const inv = invitation as Record<string, unknown>;
    const status = inv.status as string;
    if (status === "revoked") return errorResponse("revoked");
    if (status === "expired") return errorResponse("invalid_or_expired");

    const professionalId = (inv.professional_id as string | null) ?? null;
    const tenantId = (inv.tenant_id as string | null) ?? null;

    // Helper idempotente para vincular professional (guard contra sobrescrita).
    const tryLinkProfessional = async (profId: string | null, tId: string | null, uId: string | null) => {
      if (!profId || !tId || !uId) return;
      const { data: prof, error: profErr } = await service
        .from("professionals")
        .select("profile_id, tenant_id")
        .eq("id", profId)
        .maybeSingle();
      if (profErr) {
        console.error("accept-invitation: professional select failed", {
          code: (profErr as { code?: string }).code ?? "no-code",
          message: (profErr as { message?: string }).message ?? "no-message",
        });
        return;
      }
      const profTenant = (prof as { tenant_id?: string | null } | null)?.tenant_id ?? null;
      if (profTenant !== tId) return; // tenant mismatch (guard)
      const currentProfileId = (prof as { profile_id?: string | null } | null)?.profile_id ?? null;
      if (currentProfileId === uId) return; // já vinculado (idempotente)
      if (currentProfileId !== null && currentProfileId !== undefined) return; // guard contra sobrescrita
      const { data: updated, error: linkErr } = await service
        .from("professionals")
        .update({ profile_id: uId })
        .eq("id", profId)
        .eq("tenant_id", tId)
        .is("profile_id", null)
        .select("id");
      if (linkErr) {
        console.error("accept-invitation: professional link failed", {
          code: (linkErr as { code?: string }).code ?? "no-code",
          message: (linkErr as { message?: string }).message ?? "no-message",
        });
        return;
      }
      if (!updated || (Array.isArray(updated) && updated.length === 0)) return; // no-op (0 rows)
      const { error: auditErr } = await service.from("audit_log").insert({
        tenant_id: tId,
        actor_id: uId,
        action: "professional.linked",
        target_type: "professional",
        target_id: profId,
        metadata: { professional_id: profId, profile_id: uId, tenant_id: tId },
      });
      if (auditErr) {
        console.error("accept-invitation: audit insert failed", {
          code: (auditErr as { code?: string }).code ?? "no-code",
          message: (auditErr as { message?: string }).message ?? "no-message",
        });
      }
    };

    if (status === "accepted") {
      let linkUserId: string | null = (inv.accepted_user_id as string | null) ?? null;
      if (professionalId && !linkUserId) {
        try {
          linkUserId = await findUserIdByEmail(extractAdmin(service), inv.email as string);
        } catch (err) {
          console.error("accept-invitation: user resolution failed", err instanceof Error ? err.name : "erro");
        }
      }
      await tryLinkProfessional(professionalId, tenantId, linkUserId);
      return okResponse({ ok: true, role: inv.role as string });
    }

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
    // Encontra ou cria o usuário no Auth (lookup via listUsers — getUserByEmail
    // não existe no supabase-js via JSR no edge runtime).
    // Usuário pré-existente (criado pelo inviteUserByEmail no envio) tem a senha
    // aplicada via updateUserById; usuário novo recebe a senha no createUser.
    const admin = extractAdmin(service);
    let userId: string | null = null;
    let createdNow = false;
    try {
      userId = await findUserIdByEmail(admin, email);
      if (!userId && typeof admin?.createUser === "function") {
        const password = body.password ?? randomPassword();
        const { data, error } = await admin.createUser({
          email,
          password,
          email_confirm: true,
        });
        if (error) {
          console.error("accept-invitation: createUser failed", {
            code: (error as { code?: string }).code ?? "no-code",
            message: (error as { message?: string }).message ?? "no-message",
          });
          // Corrida: usuário criado entre o lookup e o create (ex.: inviteUserByEmail
          // no envio já criou o usuário no GoTrue) — tenta resolver de novo.
          if (isEmailExistsError(error)) {
            userId = await findUserIdByEmail(admin, email);
          }
        } else {
          userId = data?.user?.id ?? null;
          if (userId) createdNow = true;
        }
      }
      // Caminho "já existia" (lookup inicial ou retry após email_exists):
      // aplica a senha do formulário — sem isso o login posterior falha porque
      // a senha digitada nunca chegava ao GoTrue.
      if (userId && !createdNow && body.password) {
        if (typeof admin?.updateUserById !== "function") {
          console.error("accept-invitation: updateUserById unavailable", {
            code: "no-update",
            message: "admin updateUserById missing",
          });
          return errorResponse("internal_error");
        }
        const { error: pwErr } = await admin.updateUserById(userId, {
          password: body.password,
          email_confirm: true,
        });
        if (pwErr) {
          console.error("accept-invitation: updateUserById failed", {
            code: (pwErr as { code?: string }).code ?? "no-code",
            message: (pwErr as { message?: string }).message ?? "no-message",
          });
          // Falha aqui deixa o usuário sem senha conhecida (inútil) — falha o aceite.
          return errorResponse("internal_error");
        }
      }
    } catch (err) {
      console.error("accept-invitation: user resolution failed", err instanceof Error ? err.name : "erro");
    }

    if (!userId) return errorResponse("internal_error");

    // Guard contra troca de empresa: profile existente vinculado a outro
    // tenant não pode ser sobrescrito — nega com 409 sem upsert.
    const { data: existingProfile, error: existingErr } = await service
      .from("profiles")
      .select("tenant_id")
      .eq("id", userId)
      .maybeSingle();
    if (existingErr) {
      console.error("accept-invitation: profile select failed", {
        code: (existingErr as { code?: string }).code ?? "no-code",
        message: (existingErr as { message?: string }).message ?? "no-message",
      });
      return errorResponse("internal_error");
    }
    const existingTenant =
      (existingProfile as { tenant_id?: string | null } | null)?.tenant_id ?? null;
    if (existingTenant !== null && existingTenant !== tenantId) {
      return errorResponse("tenant_conflict");
    }

    const { error: profileErr } = await service.from("profiles").upsert(
      {
        id: userId,
        tenant_id: tenantId,
        role,
        email,
      },
      { onConflict: "id" },
    );
    if (profileErr) {
      console.error("accept-invitation: profile upsert failed", {
        code: (profileErr as { code?: string }).code ?? "no-code",
        message: (profileErr as { message?: string }).message ?? "no-message",
      });
      return errorResponse("internal_error");
    }

    // Vínculo professional antes de marcar accepted (idempotente).
    await tryLinkProfessional(professionalId, tenantId, userId);
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
      metadata: { role, ...(professionalId ? { professional_id: professionalId } : {}) },
    });

    return okResponse({ ok: true, role });
  };
}
