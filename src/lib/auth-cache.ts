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
 * - Em `SIGNED_OUT` esvazia TODAS as demais queries (`query.reset()` sobre o
 *   cache), para que dados da conta anterior (clientes, agendamentos, ficha,
 *   etc.) não sobrem num navegador compartilhado. `reset` mantém o objeto da
 *   query no cache e não refaz fetch: observadores montados recebem o estado
 *   vazio e, no re-render, não disparam `queryFn` sem sessão. Com
 *   `removeQueries`, o re-render recriaria a query e buscaria dados sem
 *   sessão. `resetQueries` também não serve: refaz as queries ativas.
 *   O guard redireciona e desmonta as telas em seguida.
 * - Em QUALQUER evento que troque a sessão para OUTRO usuário (login sem sair
 *   antes, pela URL de `/login` ou por outra aba; `PASSWORD_RECOVERY` de outra
 *   conta, que o supabase-js emite sem `SIGNED_IN`) remove as chaves de
 *   identidade (`profile` e `tenant`) da conta anterior, para que não sejam
 *   refeitas com o token da conta nova. As demais queries recebem
 *   `resetQueries`: observadores montados são notificados e refeitos com a
 *   conta nova, sem dados da conta anterior.
 * - `SIGNED_IN` sem sessão anterior conhecida (`null` após `SIGNED_OUT`, que já
 *   limpou o cache; ou `undefined` quando a sessão ainda não carregou) e
 *   `SIGNED_IN` do mesmo usuário (reentrada, refresh) não removem nada.
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
    // `query.reset()` sem refetch: `resetQueries` refaria as queries ativas.
    queryClient
      .getQueryCache()
      .findAll({ predicate: notSessionQuery })
      .forEach((query) => query.reset());
    return;
  }

  // Troca de conta vale para qualquer evento que mude a sessão para outro
  // usuário (ex.: `PASSWORD_RECOVERY` de outra conta é emitido sem `SIGNED_IN`).
  // Só `previous` com sessão válida conta como conta anterior. `undefined`
  // (sessão ainda não carregada) e `null` (já deslogado) não são troca de conta.
  const switchedUser =
    !!previous && !!session && previous.user.id !== session.user.id;

  if (switchedUser) {
    const identityQuery = (query: { queryKey: readonly unknown[] }) =>
      query.queryKey[0] === "profile" || query.queryKey[0] === "tenant";

    queryClient.removeQueries({ predicate: identityQuery });
    void queryClient.resetQueries({ predicate: notSessionQuery });
  }
}
