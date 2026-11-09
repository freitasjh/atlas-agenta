// Entrada da Edge Function `verify-operator` — prova server-side de operador+AAL2.
// Molde: supabase/functions/admin-plan/index.ts (entrada fina + handler testável).
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { createVerifyOperatorHandler } from "./handler.ts";

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

Deno.serve(createVerifyOperatorHandler({ createService: createServiceClient }));
