import { z } from "zod";

import { ROLES, type Role } from "@/types/domain";

/**
 * Identidade do usuário logado lida das claims do access token — ADR-07.
 *
 * O hook `custom-access-token` (ADR-01) emite `user_role`, `tenant_id` e
 * `must_change_password` a cada login/renovação. O cliente usa essas claims
 * para ROTEAR e ESCONDER controles; decodificar no cliente NÃO é fronteira de
 * segurança — a fronteira é o RLS e as Edge Functions.
 *
 * Claims NUNCA vêm de `user_metadata`: aquele campo é editável pelo próprio
 * usuário e não serve para papel, empresa nem flag.
 */
export interface AuthClaims {
  role: Role;
  /** `null` para `super_admin` (invariante do banco: sem tenant). */
  tenantId: string | null;
  mustChangePassword: boolean;
}

/**
 * Payload mínimo aceito. Chave ausente reprova — `tenant_id` ausente não é o
 * mesmo que `tenant_id: null` (nulo é a claim legítima do `super_admin`).
 * `tenant_id` é validado como UUID porque é o contrato emitido pelo hook
 * (ADR-01): string fora desse formato é claim corrompida ⇒ `null` (fail-closed).
 */
const claimsSchema = z.object({
  user_role: z.enum(ROLES),
  tenant_id: z.string().uuid().nullable(),
  must_change_password: z.boolean(),
});

/**
 * Decodifica a parte `base64url` do token. Devolve `null` em qualquer falha de
 * decodificação — nunca lança.
 */
function decodeBase64Url(segment: string): string | null {
  try {
    const normalized = segment.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(
      normalized.length + ((4 - (normalized.length % 4)) % 4),
      "=",
    );
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}

/**
 * Extrai as claims de identidade do access token.
 *
 * Retorna `null` (nunca lança) para: token malformado (menos de 3 partes,
 * base64url inválido, payload que não é JSON), claim ausente, `user_role` fora
 * do enum canônico ou `must_change_password` que não seja boolean. `null` é
 * tratado como `hasIdentityError` pelo agregador — fail-closed.
 */
export function parseAuthClaims(accessToken: string): AuthClaims | null {
  if (!accessToken) return null;

  const parts = accessToken.split(".");
  if (parts.length < 3) return null;

  const payloadJson = decodeBase64Url(parts[1]);
  if (payloadJson === null) return null;

  let payload: unknown;
  try {
    payload = JSON.parse(payloadJson);
  } catch {
    return null;
  }

  const parsed = claimsSchema.safeParse(payload);
  if (!parsed.success) return null;

  return {
    role: parsed.data.user_role,
    tenantId: parsed.data.tenant_id,
    mustChangePassword: parsed.data.must_change_password,
  };
}
