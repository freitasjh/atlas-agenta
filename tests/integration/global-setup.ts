// Pré-checagem e ciclo de vida do stack local antes da suíte de integração (ADR-13).
//
// Pré-requisitos:
//   1. `supabase start` ativo (Postgres, Auth, PostgREST, Docker) e banco no estado de
//      `supabase db reset`;
//   2. `supabase/functions/.env` presente (ignorado pelo git) com
//      `CUSTOM_ACCESS_TOKEN_HOOK_SECRET` igual ao usado pelo GoTrue no `supabase start`.
//
// A suíte sobe e encerra o `supabase functions serve` por conta própria: precisa controlar
// `BOOTSTRAP_SECRET` e `ATLAS_ENV` para os casos de 404/401/403 do bootstrap. As credenciais do
// stack são lidas de `supabase status -o env` quando não estiverem no ambiente do runner.
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { serviceClient } from "./helpers/clients.ts";
import { loadEnv, readFunctionsEnv } from "./helpers/env.ts";
import { ensureFunctionsDefault, teardownFunctions } from "./helpers/functions-server.ts";

/**
 * A seed do `supabase db reset` cria o super admin `admin@neox.com.br` e o respectivo operador
 * interno. A suíte precisa do estado "sem super admin" (o `bootstrap.test.ts` falha alto se ele
 * existir) e de `internal_operators` vazio para criar os super admins de teste pelo caminho que o
 * trigger `freeze_super_admin_role` permite (greenfield libera). Esta é uma limpeza prévia
 * explícita do ambiente local — nunca desabilita trigger nem afrouxa a regra de negócio.
 */
async function removeSeededSuperAdmin(): Promise<void> {
  const admin = serviceClient();
  const target = "admin@neox.com.br";
  const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (error) {
    throw new Error(`Listagem de usuários para limpeza da seed falhou (status ${error.status ?? "sem status"}).`);
  }
  const seeded = data.users.find((user) => (user.email ?? "").toLowerCase() === target);
  if (!seeded) return;

  // `internal_operators.user_id` referencia `auth.users` sem cascade: remove o operador antes,
  // senão a exclusão do usuário esbarra na FK. O profile cai em cascade com o usuário.
  const { error: operatorError } = await admin
    .from("internal_operators")
    .delete()
    .eq("user_id", seeded.id);
  if (operatorError) {
    throw new Error(`Limpeza do operador da seed falhou (código ${operatorError.code ?? "vazio"}).`);
  }
  const { error: deleteError } = await admin.auth.admin.deleteUser(seeded.id);
  if (deleteError) {
    throw new Error(`Limpeza do super admin da seed falhou (status ${deleteError.status ?? "sem status"}).`);
  }
}

const PROJECT_ROOT = fileURLToPath(new URL("../../", import.meta.url));

const ENV_FROM_CLI: Record<string, string> = {
  API_URL: "SUPABASE_URL",
  ANON_KEY: "SUPABASE_ANON_KEY",
  SERVICE_ROLE_KEY: "SUPABASE_SERVICE_ROLE_KEY",
  DB_URL: "SUPABASE_DB_URL",
};

/** Completa o ambiente do runner com `supabase status -o env` quando as chaves faltarem. */
function ensureStackEnv(): void {
  if (process.env.SUPABASE_DB_URL && process.env.SUPABASE_ANON_KEY && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return;
  }

  let output: string;
  try {
    output = execFileSync("supabase", ["status", "-o", "env"], {
      cwd: PROJECT_ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    throw new Error("Stack local inacessível. Rode `supabase start` antes da suíte.");
  }

  for (const line of output.split(/\r?\n/)) {
    const separator = line.indexOf("=");
    if (separator <= 0) continue;
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim().replace(/^"|"$/g, "");
    const target = ENV_FROM_CLI[key];
    if (target && !process.env[target]) process.env[target] = value;
  }
}

export default async function setup(): Promise<() => Promise<void>> {
  ensureStackEnv();
  const env = loadEnv();

  // Teto de 2s: se o GoTrue estiver subindo ou pendurado, o setup falha com mensagem clara
  // em vez de esperar o timeout do TCP (que passa de 60s e parece travamento).
  const health = await fetch(`${env.apiUrl}/auth/v1/health`, {
    signal: AbortSignal.timeout(2_000),
  }).catch(() => null);
  if (!health || !health.ok) {
    throw new Error(
      "Stack local inacessível em /auth/v1/health. Rode `supabase start` antes da suíte.",
    );
  }

  // Limpeza prévia: o `db reset` semeia um super admin; a suíte parte do estado sem ele.
  await removeSeededSuperAdmin();

  const functionsEnv = readFunctionsEnv();
  if (!functionsEnv.CUSTOM_ACCESS_TOKEN_HOOK_SECRET) {
    throw new Error(
      "CUSTOM_ACCESS_TOKEN_HOOK_SECRET ausente em supabase/functions/.env; o hook do GoTrue não seria autenticado.",
    );
  }

  await ensureFunctionsDefault();

  return async (): Promise<void> => {
    await teardownFunctions();
  };
}
