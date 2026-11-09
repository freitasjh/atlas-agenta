// Helpers de operador interno (internal-operators-mfa, BE-02/BE-03).
// Único caminho server-side: `auth.getUser(jwt)` + factors AAL2 por request via Admin API,
// nunca claim do cliente. Sem PII em log. Fail-closed: qualquer erro nega.
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { ApiError } from "./http.ts";

export type AalLevel = "aal1" | "aal2";

export interface OperatorVerification {
  userId: string;
  isOperator: boolean;
  aal: AalLevel;
}

/** Lista factors MFA verificados do usuário via Admin API (server-side, por request). */
export async function readVerifiedFactorsCount(
  service: SupabaseClient,
  userId: string,
): Promise<number> {
  const admin = (service.auth as unknown as {
    admin: { mfa: { listFactors: (args: { userId: string }) => Promise<{ data: unknown; error: unknown }> } };
  }).admin;
  const { data, error } = await admin.mfa.listFactors({ userId });
  if (error) throw new ApiError(500, "INTERNAL");
  // GoTrue Admin real (supabase-js) retorna { data: { factors: [...] } };
  // array puro e objeto ({ all | totp | phone }) mantidos por compat legada.
  if (Array.isArray(data)) {
    let verified = 0;
    for (const f of data) {
      const status = (f as { status?: string }).status;
      const flag = (f as { verified?: boolean }).verified;
      if (status === "verified" || flag === true) verified += 1;
    }
    return verified;
  }
  const factors = (data as { factors?: unknown; totp?: unknown[]; phone?: unknown[] } | { all?: unknown[] } | null) ?? null;
  if (!factors || typeof factors !== "object") return 0;
  const lists: unknown[][] = [];
  if (Array.isArray((factors as { factors?: unknown }).factors)) {
    const raw = (factors as { factors: unknown }).factors as unknown[];
    let verified = 0;
    for (const f of raw) {
      const status = (f as { status?: string }).status;
      const flag = (f as { verified?: boolean }).verified;
      if (status === "verified" || flag === true) verified += 1;
    }
    return verified;
  }
  if (Array.isArray((factors as { all?: unknown[] }).all)) lists.push((factors as { all: unknown[] }).all);
  if (Array.isArray((factors as { totp?: unknown[] }).totp)) lists.push((factors as { totp: unknown[] }).totp!);
  if (Array.isArray((factors as { phone?: unknown[] }).phone)) lists.push((factors as { phone: unknown[] }).phone!);
  if (lists.length === 0) return 0;
  let verified = 0;
  for (const list of lists) {
    for (const f of list) {
      const status = (f as { status?: string; verified?: boolean }).status;
      const flag = (f as { verified?: boolean }).verified;
      if (status === "verified" || flag === true) verified += 1;
    }
  }
  return verified;
}

/**
 * Lê o `aal` da sessão direto do payload do JWT (server-side).
 *
 * Decisão C5 (enrollment × assurance): `readVerifiedFactorsCount` prova
 * ENROLLMENT (factor verificado existe) mas não prova ASSURANCE (sessão atual
 * fez MFA). O `aal` vive no JWT, não no `User` do `getUser`. Como
 * `verifyInternalOperator` chama `getUser(token)` antes — e o Auth valida a
 * assinatura no servidor — decodificar o payload do MESMO token depois é
 * seguro: token forjado nunca passa do `getUser`. Exige-se `aal === "aal2"`
 * NA SESSÃO + factor verificado; qualquer divergência nega com o mesmo 403.
 */
export function readJwtAal(token: string): string | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    let b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const pad = b64.length % 4;
    if (pad === 2) b64 += "==";
    else if (pad === 3) b64 += "=";
    else if (pad === 1) return null;
    const bin = atob(b64);
    let json = bin;
    try {
      json = new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
    } catch {
      json = bin;
    }
    const payload = JSON.parse(json) as { aal?: unknown };
    return typeof payload.aal === "string" ? payload.aal : null;
  } catch {
    return null;
  }
}
/** true quando o usuário é operador interno ativo (deny-all lida só com service_role). */
export async function isActiveInternalOperator(
  service: SupabaseClient,
  userId: string,
): Promise<boolean> {
  const { data, error } = await service
    .from("internal_operators")
    .select("user_id")
    .eq("user_id", userId)
    .is("disabled_at", null)
    .maybeSingle();
  if (error) throw new ApiError(500, "INTERNAL");
  return data !== null;
}

/**
 * Métrica `internal_admin_denies_total` (SPEC G10, MIG-BE-04): incrementa o
 * contador de negas BOLA/AAL2. Best-effort: nunca lança (fakes sem `rpc` e
 * falhas de rede são ignoradas). Sem PII.
 */
export async function countInternalAdminDeny(service: SupabaseClient): Promise<void> {
  try {
    const rpc = (service as unknown as { rpc?: unknown }).rpc;
    if (typeof rpc === "function") {
      await (rpc as (fn: string) => Promise<unknown>).call(service, "internal_admin_deny");
    }
  } catch {
    // best-effort: a negação já foi devolvida; a métrica não pode quebrá-la.
  }
}

/**
 * Verificação completa por request: JWT -> getUser -> operador ativo + AAL2
 * (assurance da sessão + enrollment do factor). Falha fechada: token
 * ausente/inválido, sem operador, sessão sem `aal==="aal2"` ou sem factor
 * verificado nega (403 único anti-enumeração).
 */
export async function verifyInternalOperator(
  service: SupabaseClient,
  token: string | null,
): Promise<OperatorVerification> {
  if (!token) throw new ApiError(401, "UNAUTHENTICATED");
  const { data, error } = await service.auth.getUser(token);
  if (error || !data.user) throw new ApiError(401, "UNAUTHENTICATED");
  const userId = data.user.id;
  const operator = await isActiveInternalOperator(service, userId);
  if (!operator) {
    console.warn("verify-operator: deny non-operator");
    throw new ApiError(403, "FORBIDDEN");
  }
  // Assurance: a sessão atual fez MFA? (claim `aal` do JWT já validado).
  if (readJwtAal(token) !== "aal2") {
    console.warn("verify-operator: deny without session aal2");
    throw new ApiError(403, "FORBIDDEN");
  }
  // Enrollment: existe factor verificado (revogação posterior nega aqui).
  let verified = 0;
  try {
    verified = await readVerifiedFactorsCount(service, userId);
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw new ApiError(500, "INTERNAL");
  }
  if (verified <= 0) {
    console.warn("verify-operator: deny without verified factor");
    throw new ApiError(403, "FORBIDDEN");
  }
  return { userId, isOperator: true, aal: "aal2" };
}
