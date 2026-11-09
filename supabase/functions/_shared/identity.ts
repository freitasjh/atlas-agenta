// Identidade resolvida na Edge: JWT -> auth.getUser -> profiles.
// `tenant_id` e `role` NUNCA vêm do corpo (ADR-002 §3 e I2).
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { ApiError } from "./http.ts";
import { isActiveInternalOperator, readVerifiedFactorsCount } from "./internal-operator.ts";

export interface Identity {
  userId: string;
  tenantId: string;
  role: string;
}

export type PaymentRole = "admin" | "receptionist" | "professional";

/**
 * Resolve o ator do JWT e confere papel/tenant/active.
 * Lança `ApiError(401, "UNAUTHENTICATED")` para token ausente/inválido e
 * `ApiError(403, "FORBIDDEN")` para perfil ausente, inativo, sem tenant ou papel não permitido.
 */
export async function resolveIdentity(
  req: Request,
  service: SupabaseClient,
  roles: readonly PaymentRole[],
): Promise<Identity> {
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!token) throw new ApiError(401, "UNAUTHENTICATED");

  const { data, error } = await service.auth.getUser(token);
  if (error || !data.user) throw new ApiError(401, "UNAUTHENTICATED");

  const { data: profile, error: profileError } = await service
    .from("profiles")
    .select("tenant_id, role, active")
    .eq("id", data.user.id)
    .maybeSingle();

  if (profileError) throw new ApiError(500, "INTERNAL");

  const role = typeof profile?.role === "string" ? profile.role : "";
  if (
    !profile?.tenant_id ||
    profile.active !== true ||
    !(roles as readonly string[]).includes(role)
  ) {
    throw new ApiError(403, "FORBIDDEN");
  }

  return { userId: data.user.id, tenantId: profile.tenant_id as string, role };
}

/**
 * Gate de operador interno (BE-03): super_admin só opera com registro ativo em
 * `internal_operators` + factor MFA verificado (AAL2 server-side por request).
 * Fail-closed: qualquer falha nega com 403 FORBIDDEN (sem distinguir o motivo).
 */
export async function requireInternalOperator(
  service: SupabaseClient,
  userId: string,
): Promise<void> {
  const operator = await isActiveInternalOperator(service, userId);
  if (!operator) {
    console.warn("identity: deny non-operator");
    throw new ApiError(403, "FORBIDDEN");
  }
  const verified = await readVerifiedFactorsCount(service, userId);
  if (verified <= 0) {
    console.warn("identity: deny without aal2");
    throw new ApiError(403, "FORBIDDEN");
  }
}

/** true quando o profissional autenticado é o responsável pelo atendimento. */
export async function isProfessionalOwner(
  service: SupabaseClient,
  tenantId: string,
  userId: string,
  appointmentProfessionalId: string,
): Promise<boolean> {
  const { data, error } = await service
    .from("professionals")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("profile_id", userId)
    .maybeSingle();
  if (error) throw new ApiError(500, "INTERNAL");
  return data?.id === appointmentProfessionalId;
}
