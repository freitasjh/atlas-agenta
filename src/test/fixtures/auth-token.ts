import type { Role } from "@/types/domain";

/**
 * Fixtures de token para os testes de claims (ADR-07).
 *
 * Helper único: qualquer teste que precise de um JWT de mentira usa
 * `tokenWith`, com o payload vindo de `claimsPayload`.
 * `alg: none` de propósito — nada aqui é assinado nem verificado.
 */

/** UUID canônico de tenant nos testes (mesmo formato do hook `custom-access-token`). */
export const TENANT_ID = "3f1a5c2e-8b7d-4a1f-9c3e-2d4b5a6c7e8f";

/** Monta um JWT `alg.none` de teste com o payload informado (base64url). */
export function tokenWith(payload: Record<string, unknown>): string {
  const header = btoa(JSON.stringify({ alg: "none", typ: "JWT" }));
  const body = btoa(JSON.stringify(payload))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return `${header}.${body}.signature`;
}

/** Payload de claims de um usuário comum do tenant, com sobrescritas livres. */
export function claimsPayload(
  overrides: Partial<{
    user_role: Role;
    tenant_id: string | null;
    must_change_password: boolean;
    active: boolean;
  }> = {},
): Record<string, unknown> {
  return {
    sub: "user-1",
    user_role: "professional",
    tenant_id: TENANT_ID,
    must_change_password: false,
    active: true,
    ...overrides,
  };
}
