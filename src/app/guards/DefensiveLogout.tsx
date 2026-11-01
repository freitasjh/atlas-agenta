import { useEffect } from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";

import { RouteFallback } from "@/components/RouteFallback";
import { useSignOut } from "@/hooks/useAuthMutations";
import { useCurrentUser } from "@/hooks/useCurrentUser";

/**
 * Logout defensivo dos guards (ADR-08/ADR-11). Disparado quando há sessão viva
 * mas a identidade não pôde ser lida (claims ausentes/inválidas ou tenant com
 * erro de RLS, linha ausente ou falha de rede): isso é falha de autorização,
 * não acesso anônimo.
 *
 * Só redirecionar para `/login` não basta — `useSession` tem `staleTime:
 * Infinity`, então a sessão continua viva no cache, `isAuthenticated` segue
 * `true` e o usuário fica preso num ciclo entre a rota privada e `/login`.
 * Aqui encerramos a sessão de fato (`useSignOut` → `signOut()` + `queryClient
 * .clear()`) e só então mandamos para `/login`, com `state.from` como string
 * (`pathname + search`, ADR-11).
 *
 * O `signOut()` é despachado no mount assim que a identidade fica ilegível e
 * não há cancelamento: se as claims voltarem a ser legíveis depois (renovação
 * de token em outra aba), o dispatch já ocorreu e a sessão é encerrada de
 * qualquer forma — postura fail-closed. A releitura de `useCurrentUser` só
 * evita o logout quando a identidade já é legível no primeiro render: aí
 * devolvemos `<Outlet />` e os guards seguintes reavaliam papel e assinatura.
 * Sem sessão, não há o que encerrar: vai direto ao login.
 *
 * Enquanto o `signOut()` não resolve, mostramos o fallback (sem flash de app).
 * O `AuthListener` zera o cache da sessão no evento `SIGNED_OUT`, o que derruba
 * `isAuthenticated` e torna o `/login` uma superfície limpa de re-autenticação.
 */
export function DefensiveLogout() {
  const { pathname, search } = useLocation();
  const { isAuthenticated, hasIdentityError, hasTenantError } = useCurrentUser();
  const signOut = useSignOut();
  const { mutate } = signOut;

  const identityUnreadable =
    isAuthenticated && (hasIdentityError || hasTenantError);

  useEffect(() => {
    if (identityUnreadable) mutate();
  }, [identityUnreadable, mutate]);

  const from = `${pathname}${search}`;

  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from }} />;
  }

  if (!identityUnreadable) {
    return <Outlet />;
  }

  // Só navega depois que a sessão foi efetivamente encerrada, evitando o loop
  // com guards que ainda enxergariam a sessão viva. Este ramo só é alcançado
  // enquanto a identidade segue ilegível (o `<Outlet />` acima tem precedência).
  if (signOut.isSuccess || signOut.isError) {
    return <Navigate to="/login" replace state={{ from }} />;
  }

  return <RouteFallback />;
}
