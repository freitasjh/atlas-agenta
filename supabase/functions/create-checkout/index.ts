import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { createHandler } from "./handler.ts";
function createServiceClient(): SupabaseClient {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("config");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
Deno.serve(createHandler({ createService: createServiceClient }));
