// Entrada da Edge Function `change-password` — ADR-04 (troca de senha no Auth nativo).
//
// A lógica está em handler.ts, que os testes importam sem subir servidor. Aqui só o ambiente do
// runtime: leitura das variáveis, client com a service role e `Deno.serve`.
//
// A função exige JWT de usuário (`verify_jwt` no default do config.toml): o gateway responde 401
// para token inválido, e o handler ainda confirma o usuário com `auth.getUser` antes de qualquer
// escrita. A senha nova e a limpeza de `app_metadata.must_change_password` acontecem numa única
// chamada à API admin do Auth.
//
// Molde: `supabase/functions/bootstrap-super-admin/index.ts` (entrada fina + handler testável).
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { createChangePasswordHandler } from "./handler.ts";

/** Timeout de cada chamada HTTP do client: evita pendurar a requisição em rede travada. */
const HTTP_TIMEOUT_MS = 15_000;

/** Client com a service role (bypassa RLS). Só no servidor, nunca exposto ao cliente. */
function createServiceClient(): SupabaseClient {
  const url = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceRoleKey) {
    throw new Error("Configuração do servidor ausente (SUPABASE_URL/SERVICE_ROLE_KEY).");
  }
  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (input, init) =>
        fetch(input, {
          ...init,
          signal: AbortSignal.any([
            ...(init?.signal ? [init.signal] : []),
            AbortSignal.timeout(HTTP_TIMEOUT_MS),
          ]),
        }),
    },
  });
}

Deno.serve(createChangePasswordHandler({ createService: createServiceClient }));
