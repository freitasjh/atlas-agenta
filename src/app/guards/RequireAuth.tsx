import { Navigate, Outlet, useLocation } from "react-router-dom";

import { RouteFallback } from "@/components/RouteFallback";
import { DefensiveLogout } from "@/app/guards/DefensiveLogout";
import { useCurrentUser } from "@/hooks/useCurrentUser";

/**
 * Guard de autenticação. Deriva a sessão de `useCurrentUser` (servidor, sob
 * RLS) — nunca lê nem envia `tenant_id` do cliente.
 *
 * - Carregando → fallback de rota (sem flash de login).
 * - Sessão com identidade/tenant ilegível (RLS nega / linha ausente / rede) →
 *   logout defensivo: encerra a sessão e manda para `/login` (postura anti
 *   "fail-open"; sem logout a sessão viva prenderia o usuário em loop).
 * - Sem sessão → `/login`, preservando a origem em `state.from` como string
 *   (`pathname + search`, ADR-11).
 * - Com sessão válida → `<Outlet />`.
 */
export function RequireAuth() {
  const location = useLocation();
  const { isLoadingAuth, isAuthenticated, hasIdentityError, hasTenantError } =
    useCurrentUser();

  if (isLoadingAuth) {
    return <RouteFallback />;
  }

  // Sessão viva mas identidade ilegível: encerrar a sessão antes de sair, senão
  // o usuário fica preso entre a rota privada e `/login`.
  if (isAuthenticated && (hasIdentityError || hasTenantError)) {
    return <DefensiveLogout />;
  }

  if (!isAuthenticated) {
    return (
      <Navigate
        to="/login"
        replace
        state={{ from: `${location.pathname}${location.search}` }}
      />
    );
  }

  return <Outlet />;
}
