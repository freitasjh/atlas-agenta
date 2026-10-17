import { Navigate, Outlet, useLocation } from "react-router-dom";

import { Skeleton } from "@/components/ui/skeleton";
import { useCurrentUser } from "@/hooks/useCurrentUser";

/**
 * Skeleton de rota cheia enquanto a cadeia sessão → profile → tenant resolve.
 * Evita o "flash de login": sem sessão confirmada, mostramos carregamento, não
 * a tela pública.
 */
function RouteFallback() {
  return (
    <div className="flex min-h-screen flex-col gap-4 p-6" aria-hidden="true">
      <Skeleton className="h-10 w-40" />
      <Skeleton className="h-64 w-full" />
    </div>
  );
}

/**
 * Guard de autenticação. Deriva a sessão de `useCurrentUser` (servidor, sob
 * RLS) — nunca lê nem envia `tenant_id` do cliente.
 *
 * - Carregando → fallback de rota (sem flash de login).
 * - Sessão sem profile legível (RLS nega / linha ausente) → não autorizado:
 *   trata como anônimo e manda para `/login` (postura anti "fail-open").
 * - Sem sessão → `/login`, preservando a origem em `state.from`.
 * - Com sessão válida → `<Outlet />`.
 */
export function RequireAuth() {
  const location = useLocation();
  const { isLoadingAuth, isAuthenticated, hasProfileError } = useCurrentUser();

  if (isLoadingAuth) {
    return <RouteFallback />;
  }

  if (!isAuthenticated || hasProfileError) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  return <Outlet />;
}
