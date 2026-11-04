// Schemas e montagem de claims do hook `custom_access_token` — ADR-01.
//
// O corpo do hook é DADO NÃO CONFIÁVEL: só é lido depois da assinatura Standard Webhooks ser
// validada (index.ts). Aqui o corpo é validado com zod antes de qualquer leitura do banco.
//
// Regras de claims (contrato em analysis-data.md, D-B e D-C):
//   - `user_role` e `tenant_id` vêm de `profiles` (fonte da verdade). Sem profile: ambos nulos.
//   - `must_change_password` vem de `app_metadata.must_change_password`. Ausente vale `false`.
//     Valor que não seja booleano é recusado (identidade inválida).
//   - `role` NUNCA é emitido nem sobrescrito: é o papel Postgres (`authenticated`) do PostgREST.
import { z } from "npm:zod@3.23.8";

export const ROLE_VALUES = ["super_admin", "admin", "professional", "receptionist"] as const;

/** Entrada do hook: `{ user_id, claims, authentication_method }`. Campos extras são tolerados. */
export const hookInputSchema = z.object({
  user_id: z.string().uuid(),
  claims: z.record(z.string(), z.unknown()),
  authentication_method: z.string().optional(),
});

export type HookInput = z.infer<typeof hookInputSchema>;

/** Linha de `profiles` lida com service role. Validada antes de uso. */
export const profileRowSchema = z.object({
  role: z.enum(ROLE_VALUES),
  tenant_id: z.string().uuid().nullable(),
  active: z.boolean(),
});

export type ProfileRow = z.infer<typeof profileRowSchema>;

export type HookClaimsResult =
  | { ok: true; claims: Record<string, unknown> }
  | { ok: false; code: "identity_invalid" };

/**
 * Lê `must_change_password` de `app_metadata`. Devolve `null` quando o valor existe e não é
 * booleano, para o chamador recusar a identidade.
 */
export function readMustChangePassword(claims: Record<string, unknown>): boolean | null {
  const appMetadata = claims.app_metadata;
  if (appMetadata === undefined || appMetadata === null) return false;
  if (typeof appMetadata !== "object" || Array.isArray(appMetadata)) return null;

  const flag = (appMetadata as Record<string, unknown>).must_change_password;
  if (flag === undefined) return false;
  if (typeof flag !== "boolean") return null;
  return flag;
}

/**
 * Monta as claims devolvidas ao GoTrue: as claims originais, preservadas, mais `user_role`,
 * `tenant_id` e `must_change_password`. O `role` original do token não é tocado.
 */
export function buildHookClaims(
  claims: Record<string, unknown>,
  profile: ProfileRow | null,
): HookClaimsResult {
  const mustChangePassword = readMustChangePassword(claims);
  if (mustChangePassword === null) {
    return { ok: false, code: "identity_invalid" };
  }

  return {
    ok: true,
    claims: {
      ...claims,
      user_role: profile?.role ?? null,
      tenant_id: profile?.tenant_id ?? null,
      must_change_password: mustChangePassword,
      active: profile?.active ?? false,
    },
  };
}
