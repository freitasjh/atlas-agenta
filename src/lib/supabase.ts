import {
  createClient,
  type Subscription,
  type SupabaseClient,
} from "@supabase/supabase-js";

import { env, isSupabaseConfigured } from "@/lib/env";

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
 * ----------------------------------------------------------------------------
 * Causa-raiz da intolerância a `.env` ausente (2ª tentativa):
 * O `AuthListener`, montado no `RootLayout` que envolve TODAS as rotas públicas,
 * chama `supabase.auth.onAuthStateChange(...)` num `useEffect` que roda no mount
 * de QUALQUER rota. Esse acesso acontece sempre no load. Com
 * `@supabase/supabase-js`, chamar `createClient` com URL vazia lança
 * `supabaseUrl is required` de forma síncrona — então adiar a construção (lazy
 * Proxy) não basta: o acesso no load sempre dispararia o `createClient("", "")`
 * e derrubaria a SPA (tela branca) mesmo nas rotas que não usam Supabase.
 *
 * Correção em duas camadas (sinal + no-op), complementada pelo guard do
 * consumidor:
 *  1. `env.ts` expõe `isSupabaseConfigured` — fonte única de verdade sobre a
 *     configuração, derivada do mesmo `safeParse` que emite o aviso pt-BR.
 *  2. Aqui, quando NÃO configurado, `getClient()` NUNCA chama o `createClient`
 *     real: devolve um client no-op inerte com a mesma superfície tocada no load
 *     (`auth.onAuthStateChange`). Assim, tocar o client no load sem `.env` nunca
 *     lança, e o export `supabase` continua estável para os 6 consumidores (que
 *     permanecem inalterados).
 *
 * Com `.env` presente (mesmo credencial inválida) o caminho é SEMPRE o
 * `createClient` real: o no-op não intercepta, e um erro de credencial propaga
 * normalmente como estado de erro do TanStack Query dentro de
 * `queryFn`/`mutationFn` — nunca é mascarado nem vira throw no load.
 *
 * Construção preguiçosa (lazy) via Proxy: `createClient` (ou o no-op) só é
 * resolvido no primeiro acesso de propriedade, memoizado numa variável de
 * módulo (um único client por caminho). O aviso pt-BR de env ausente continua
 * vindo de `env.ts`.
 * ----------------------------------------------------------------------------
 */

let client: SupabaseClient | null = null;

/**
 * Client no-op seguro para o estado "não configurado" (sem `.env` válido).
 *
 * Cobre só a superfície tocada no LOAD: `auth.onAuthStateChange`. Devolve a mesma
 * forma que o client real — `{ data: { subscription } }` com um `Subscription`
 * completo cujo `unsubscribe` é um no-op seguro — e NÃO invoca o callback (não
 * simula eventos de auth). Isso mantém o `AuthListener` funcionando (assina e
 * desassina sem erro) enquanto não há Supabase configurado.
 *
 * O cast parcial → `SupabaseClient` é localizado e deliberado, no mesmo espírito
 * do cast do Proxy abaixo: construímos apenas o fragmento `.auth` que o load usa.
 * Sem `any`, sem `@ts-ignore`.
 */
function createNoopClient(): SupabaseClient {
  const noopClient = {
    auth: {
      onAuthStateChange(
        callback: Subscription["callback"],
      ): { data: { subscription: Subscription } } {
        const subscription: Subscription = {
          id: "noop-supabase-unconfigured",
          callback,
          unsubscribe: () => {},
        };
        return { data: { subscription } };
      },
    },
  };

  return noopClient as unknown as SupabaseClient;
}

/**
 * Constrói o client uma única vez (memoizado) e devolve sempre a mesma instância.
 * Ramifica pelo sinal `isSupabaseConfigured`: client real via `createClient` no
 * caminho configurado; client no-op inerte quando não configurado.
 */
function getClient(): SupabaseClient {
  if (client === null) {
    client = isSupabaseConfigured
      ? createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY)
      : createNoopClient();
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
