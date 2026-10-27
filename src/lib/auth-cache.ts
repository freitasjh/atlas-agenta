import type { QueryClient } from "@tanstack/react-query";
import type { AuthChangeEvent, AuthSession } from "@supabase/supabase-js";

import { sessionQueryKey } from "@/hooks/useSession";

/**
 * Reação do cache do TanStack Query aos eventos de `onAuthStateChange`.
 *
 * Função pura para ser testável sem componente React (o projeto não tem
 * Testing Library). Chamada pelo `AuthListener` dentro do callback.
 *
 * - Sempre grava a sessão em `["session"]`.
 * - Em `SIGNED_OUT` remove TODAS as demais queries, para que dados da conta
 *   anterior (clientes, agendamentos, ficha, etc.) não sobrem num navegador
 *   compartilhado. A chave de sessão é preservada: os observadores do guard
 *   continuam com o estado de sessão enquanto decidem o redirect.
 *
 * Não usar `queryClient.clear()` aqui: ele apagaria também `["session"]`.
 */
export function applyAuthEvent(
  queryClient: QueryClient,
  event: AuthChangeEvent,
  session: AuthSession | null,
): void {
  queryClient.setQueryData(sessionQueryKey, session);

  if (event === "SIGNED_OUT") {
    queryClient.removeQueries({
      predicate: (query) => query.queryKey[0] !== sessionQueryKey[0],
    });
  }
}
