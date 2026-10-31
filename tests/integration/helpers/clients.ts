import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { loadEnv } from "./env.ts";

const clientOptions = {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
};

/** Client com a service role (bypassa RLS). Usado só para preparar e limpar dados de teste. */
export function serviceClient(): SupabaseClient {
  const env = loadEnv();
  return createClient(env.apiUrl, env.serviceRoleKey, clientOptions);
}

/** Client com a anon key, sem sessão. Base para login e signup. */
export function anonClient(): SupabaseClient {
  const env = loadEnv();
  return createClient(env.apiUrl, env.anonKey, clientOptions);
}

/** Faz login por senha com um client novo, para que cada sessão tenha o próprio estado. */
export async function signInWithPassword(
  email: string,
  password: string,
): Promise<{ client: SupabaseClient; accessToken: string; userId: string }> {
  const client = anonClient();
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error || !data.session || !data.user) {
    throw new Error(`Login de teste falhou: ${error?.message ?? "sem sessão"}`);
  }
  return { client, accessToken: data.session.access_token, userId: data.user.id };
}
