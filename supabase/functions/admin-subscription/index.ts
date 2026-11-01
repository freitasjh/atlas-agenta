// Entrada da Edge Function `admin-subscription` — ADR-03 (Fatia 1 do Painel do Super Admin) e
// ADR-06 (bloqueio por flag de troca de senha).
//
// A lógica está em handler.ts, que os testes importam sem subir servidor. Aqui só o ambiente do
// runtime: leitura das variáveis, client com a service role e `Deno.serve`.
//
// `Deno.serve` roda sempre que o módulo é o entrypoint da função (sem `import.meta.main`, como em
// `change-password`/`bootstrap-super-admin`): quem importa a lógica importa `handler.ts`.
//
// Molde: `supabase/functions/change-password/index.ts` (entrada fina + handler testável).
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { createAdminSubscriptionHandler } from "./handler.ts";

/** Client com a service role (bypassa RLS) — só no servidor, nunca exposto ao cliente. */
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

Deno.serve(createAdminSubscriptionHandler({ createService: createServiceClient }));
