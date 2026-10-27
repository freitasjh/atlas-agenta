import type { QueryClient } from "@tanstack/react-query";
import type { AuthChangeEvent, AuthSession } from "@supabase/supabase-js";

import { sessionQueryKey } from "@/lib/session-key";

/**
 * Reação do cache do TanStack Query aos eventos de `onAuthStateChange`.
 *
 * Função pura para ser testável sem componente React (o projeto não tem
 * Testing Library). Chamada pelo `AuthListener` dentro do callback.
 *
 * - Sempre grava a sessão em `["session"]`.
 * - Em `SIGNED_OUT` remove TODAS as demais queries, para que dados da conta
 *   anterior (clientes, agendamentos, ficha, etc.) não sobrem num navegador
 *   compartilhado.
 * - Em `SIGNED_IN` de OUTRO usuário (login sem sair antes, pela URL de
 *   `/login`) remove as demais queries pelo mesmo motivo. Um `SIGNED_IN` do
 *   mesmo usuário (reentrada, refresh) não remove nada.
 * - A chave de sessão é preservada em todos os casos: os observadores do guard
 *   continuam com o estado de sessão enquanto decidem o redirect.
 *
 * Não usar `queryClient.clear()` aqui: ele apagaria também `["session"]`.
 */
export function applyAuthEvent(
  queryClient: QueryClient,
  event: AuthChangeEvent,
  session: AuthSession | null,
): void {
  const previous = queryClient.getQueryData<AuthSession | null>(sessionQueryKey);
  queryClient.setQueryData(sessionQueryKey, session);

  const signedOut = event === "SIGNED_OUT";
  const switchedUser =
    event === "SIGNED_IN" && previous?.user.id !== session?.user.id;

  if (signedOut || switchedUser) {
    queryClient.removeQueries({
      predicate: (query) => query.queryKey[0] !== sessionQueryKey[0],
    });
  }
}
