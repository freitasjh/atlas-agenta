import { useEffect } from "react";
import { Navigate } from "react-router-dom";

import { RouteFallback } from "@/components/RouteFallback";
import { useSignOut } from "@/hooks/useAuthMutations";

/**
 * Logout defensivo dos guards (ADR-08). Disparado quando há sessão viva mas a
 * cadeia de identidade não pôde ser lida (profile/tenant com erro de RLS, linha
 * ausente ou falha de rede): isso é falha de autorização, não acesso anônimo.
 *
 * Só redirecionar para `/login` não basta — `useSession` tem `staleTime:
 * Infinity`, então a sessão continua viva no cache, `isAuthenticated` segue
 * `true` e o usuário fica preso num ciclo entre a rota privada e `/login`.
 * Aqui encerramos a sessão de fato (`useSignOut` → `signOut()` + `queryClient
 * .clear()`) e só então mandamos para `/login`.
 *
 * Enquanto o `signOut()` não resolve, mostramos o fallback (sem flash de app).
 * O `AuthListener` zera o cache da sessão no evento `SIGNED_OUT`, o que derruba
 * `isAuthenticated` e torna o `/login` uma superfície limpa de re-autenticação.
 */
export function DefensiveLogout() {
  const signOut = useSignOut();
  const { mutate } = signOut;

  useEffect(() => {
    mutate();
  }, [mutate]);

  // Só navega depois que a sessão foi efetivamente encerrada, evitando o loop
  // com guards que ainda enxergariam a sessão viva.
  if (signOut.isSuccess || signOut.isError) {
    return <Navigate to="/login" replace />;
  }

  return <RouteFallback />;
}
