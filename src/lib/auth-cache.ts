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
 *   compartilhado. O guard redireciona e desmonta as telas, então não há
 *   observador ativo que precise ser notificado.
 * - Em `SIGNED_IN` de OUTRO usuário (login sem sair antes, pela URL de
 *   `/login` ou por outra aba) faz `resetQueries` com o mesmo predicado. Ele
 *   notifica os observadores montados e refaz as queries ativas com a conta
 *   nova, então a tela não mostra dados da conta anterior. Um `SIGNED_IN` do
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

  const notSessionQuery = (query: { queryKey: readonly unknown[] }) =>
    query.queryKey[0] !== sessionQueryKey[0];

  if (event === "SIGNED_OUT") {
    queryClient.removeQueries({ predicate: notSessionQuery });
    return;
  }

  // `previous === undefined` significa que ["session"] ainda não foi preenchida
  // (ex.: carregamento com sessão salva). Não é troca de conta: preserva o cache.
  const switchedUser =
    event === "SIGNED_IN" &&
    previous !== undefined &&
    previous?.user.id !== session?.user.id;

  if (switchedUser) {
    // Reset em vez de remove: observadores montados recebem o estado vazio e as
    // queries ativas são refeitas com a sessão nova.
    void queryClient.resetQueries({ predicate: notSessionQuery });
  }
}
