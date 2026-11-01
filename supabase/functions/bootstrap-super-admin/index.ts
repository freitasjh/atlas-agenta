// Entrada da Edge Function `bootstrap-super-admin` — ADR-05 (super admin inicial, idempotente).
//
// A lógica está em handler.ts, que os testes importam sem subir servidor. Aqui só o ambiente do
// runtime: leitura das variáveis, client com a service role e `Deno.serve`.
//
// A função é pública (`verify_jwt = false` em config.toml) porque o operador a chama sem sessão; a
// autenticidade vem do segredo `BOOTSTRAP_SECRET`, comparado em tempo constante com o header
// `x-bootstrap-secret`. Sem o segredo no ambiente, a função responde 404 e parece não existir. A
// trava `ATLAS_ENV=local` recusa execução fora do ambiente local (403), mesmo com o segredo certo
// (P-05).
//
// Molde: `supabase/functions/custom-access-token/index.ts` (entrada fina + handler testável).
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { createBootstrapHandler, type BootstrapEnv } from "./handler.ts";

/** Ambiente lido a cada requisição: os testes trocam valores sem recarregar o módulo. */
function readEnv(): BootstrapEnv {
  return {
    bootstrapSecret: Deno.env.get("BOOTSTRAP_SECRET"),
    atlasEnv: Deno.env.get("ATLAS_ENV"),
    allowNonLocal: Deno.env.get("BOOTSTRAP_ALLOW_NON_LOCAL"),
  };
}

/** Client com a service role (bypassa RLS). Só no servidor, nunca exposto ao cliente. */
function createServiceClient(): SupabaseClient {
  const url = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceRoleKey) {
    throw new Error("Configuração do servidor ausente (SUPABASE_URL/SERVICE_ROLE_KEY).");
  }
  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

Deno.serve(createBootstrapHandler({ readEnv, createService: createServiceClient }));
