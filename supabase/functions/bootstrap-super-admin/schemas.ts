// Autenticação, trava de ambiente e formato do profile lido na Edge Function
// `bootstrap-super-admin` — ADR-05.
//
// A função é pública (`verify_jwt = false` em `supabase/config.toml`): a autenticidade vem do
// segredo compartilhado `BOOTSTRAP_SECRET`, apresentado no header `x-bootstrap-secret` e comparado
// em TEMPO CONSTANTE com o valor do ambiente. Nada aqui lê o ambiente: o handler passa os valores
// já lidos, para os testes serem puros e não dependerem de `Deno.env`.
//
// Ordem de decisão (cada falha devolve um único código, estável):
//   1. `BOOTSTRAP_SECRET` ausente na função       → 404 `nao_encontrado` (a função parece não existir)
//   2. header ausente ou segredo diferente        → 401 `nao_autorizado`
//   3. ambiente não local sem liberação explícita → 403 `ambiente_nao_local`
import { z } from "npm:zod@3.23.8";

export const BOOTSTRAP_SECRET_HEADER = "x-bootstrap-secret";

/** Decisão de acesso: liberado, ou negado com o status e o código da resposta. */
export type BootstrapAccess =
  | { ok: true }
  | {
    ok: false;
    status: 404 | 401 | 403;
    code: "nao_encontrado" | "nao_autorizado" | "ambiente_nao_local";
  };

function sha256Bytes(value: string): Promise<Uint8Array> {
  return crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))
    .then((digest) => new Uint8Array(digest));
}

/** XOR acumulado sobre bytes de mesmo tamanho: o tempo não depende do conteúdo comparado. */
function constantTimeEquals(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a[i] ^ b[i];
  }
  return diff === 0;
}

/**
 * Compara dois segredos em tempo constante. Os dois lados passam por SHA-256 antes do compare,
 * então o tempo e o tamanho dos buffers não revelam o tamanho nem o prefixo comum do segredo.
 * Nunca use `===` para comparar segredos.
 */
export async function secretsMatch(presented: string, expected: string): Promise<boolean> {
  const [presentedDigest, expectedDigest] = await Promise.all([
    sha256Bytes(presented),
    sha256Bytes(expected),
  ]);
  return constantTimeEquals(presentedDigest, expectedDigest);
}

/**
 * Trava de ambiente (P-05): só `ATLAS_ENV = 'local'` libera. `BOOTSTRAP_ALLOW_NON_LOCAL = 'true'`
 * é a exceção explícita do operador. Variável ausente ou com outro valor cai em recusa (falha
 * fechada): nenhuma execução remota acontece sem essa liberação.
 */
export function isLocalEnvironment(
  atlasEnv: string | undefined,
  allowNonLocal: string | undefined,
): boolean {
  if (atlasEnv === "local") return true;
  return allowNonLocal === "true";
}

/**
 * Decide o acesso à função. A trava de ambiente vale mesmo com o segredo certo: primeiro a
 * existência do segredo, depois a comparação, por último o ambiente.
 */
export async function authorizeBootstrapRequest(input: {
  presentedSecret: string | null;
  expectedSecret: string | undefined;
  atlasEnv: string | undefined;
  allowNonLocal: string | undefined;
}): Promise<BootstrapAccess> {
  if (!input.expectedSecret) {
    return { ok: false, status: 404, code: "nao_encontrado" };
  }
  if (
    !input.presentedSecret ||
    !(await secretsMatch(input.presentedSecret, input.expectedSecret))
  ) {
    return { ok: false, status: 401, code: "nao_autorizado" };
  }
  if (!isLocalEnvironment(input.atlasEnv, input.allowNonLocal)) {
    return { ok: false, status: 403, code: "ambiente_nao_local" };
  }
  return { ok: true };
}

/** Profile do super admin, como lido do PostgREST (`role` e `tenant_id`). Dado externo: validado. */
export const bootstrapProfileSchema = z.object({
  role: z.string().nullable(),
  tenant_id: z.string().nullable(),
});

export type BootstrapProfile = {
  role: string | null;
  tenantId: string | null;
};

/**
 * Valida a linha lida de `profiles` e devolve o estado usado por `decideBootstrapAction`.
 * `null` significa formato inesperado (erro do servidor, não recusa de papel).
 */
export function parseBootstrapProfile(raw: unknown): BootstrapProfile | null {
  const parsed = bootstrapProfileSchema.safeParse(raw);
  if (!parsed.success) return null;
  return { role: parsed.data.role, tenantId: parsed.data.tenant_id };
}
