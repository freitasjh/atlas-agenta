import { createClient } from "@supabase/supabase-js";

import { env } from "@/lib/env";

/**
 * Cliente Supabase do navegador.
 *
 * Usa EXCLUSIVAMENTE a anon key pública (`VITE_SUPABASE_ANON_KEY`) + a sessão do
 * usuário. O isolamento multi-tenant é responsabilidade do RLS no banco: nunca
 * enviar `tenant_id` do cliente como filtro para "contornar" políticas — o
 * `tenant_id` vem do JWT/`profiles` no servidor.
 *
 * A service role key (e qualquer segredo privilegiado) JAMAIS entra no bundle do
 * cliente; operações privilegiadas rodam só em Edge Functions / env do Supabase.
 *
 * Nenhuma chamada de rede dispara ao criar o client — a conexão só acontece no
 * primeiro uso.
 */
export const supabase = createClient(
  env.VITE_SUPABASE_URL,
  env.VITE_SUPABASE_ANON_KEY,
);
