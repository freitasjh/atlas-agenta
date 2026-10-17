import { createClient, type SupabaseClient } from "@supabase/supabase-js";

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
 * Construção preguiçosa (lazy) via Proxy: `createClient` NÃO roda no load do
 * módulo. Com `@supabase/supabase-js`, chamar `createClient` com URL vazia lança
 * `supabaseUrl is required` — se isso acontecesse no topo do módulo, derrubaria a
 * SPA inteira (tela branca) mesmo nas rotas públicas que não usam Supabase quando
 * o `.env` está ausente. Adiando a construção para o primeiro acesso de
 * propriedade (sempre dentro de `queryFn`/`mutationFn`/`useEffect`), as rotas
 * públicas navegam sem `.env`, e um eventual erro de credencial só aparece
 * dentro do callback do TanStack Query — como estado de erro tratado, nunca como
 * throw no load. O aviso pt-BR de env ausente continua vindo de `env.ts`.
 */

let client: SupabaseClient | null = null;

/** Constrói o client uma única vez (memoizado) e devolve sempre a mesma instância. */
function getClient(): SupabaseClient {
  if (client === null) {
    client = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY);
  }
  return client;
}

/**
 * Proxy que delega todo acesso para o client memoizado, construído sob demanda.
 * O cast para `SupabaseClient` é a única concessão de tipo (o alvo do Proxy é um
 * objeto vazio): mantém a superfície `.auth.*` / `.from(...)` idêntica para os
 * consumidores, que permanecem inalterados. Sem `any`, sem `@ts-ignore`.
 */
export const supabase = new Proxy({} as SupabaseClient, {
  get(_target, property, receiver) {
    return Reflect.get(getClient(), property, receiver);
  },
  has(_target, property) {
    return Reflect.has(getClient(), property);
  },
}) as SupabaseClient;
