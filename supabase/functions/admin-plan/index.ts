// Entrada da Edge Function `admin-plan` — troca de plano auditada.
// Molde: supabase/functions/admin-subscription/index.ts.
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { createAdminPlanHandler } from "./handler.ts";

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

Deno.serve(createAdminPlanHandler({ createService: createServiceClient }));
