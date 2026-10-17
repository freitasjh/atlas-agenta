import { Navigate, Outlet, useLocation } from "react-router-dom";

import { RouteFallback } from "@/components/RouteFallback";
import { AccessDenied } from "@/components/AccessDenied";
import { DefensiveLogout } from "@/app/guards/DefensiveLogout";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import type { Role } from "@/types/domain";

interface RequireRoleProps {
  /** Papéis autorizados a acessar as rotas filhas. */
  roles: Role[];
}

/**
 * Guard de RBAC. O `role` vem SEMPRE de `useCurrentUser` (profile do servidor,
 * sob RLS) — nunca de parâmetro do cliente; nenhum `tenant_id` é lido aqui.
 *
 * - Carregando → fallback.
 * - Sessão com profile/tenant ilegível → logout defensivo + `/login`
 *   (anti "fail-open"); não libera acesso em erro.
 * - `role` fora de `roles` → tela 403 "Acesso restrito" (nomeada, sem redirect
 *   silencioso), com link para a área do papel: `admin`/`professional`/
 *   `receptionist` → `/app`; sem papel utilizável → `/`.
 * - `role` no conjunto → `<Outlet />`.
 *
 * Nota de fase futura: as telas de `cobrancas` (financeiro) deverão usar
 * `RequireRole roles={["admin"]}` para excluir `receptionist`/`professional`.
 */
export function RequireRole({ roles }: RequireRoleProps) {
  const location = useLocation();
  const {
    isLoadingAuth,
    isAuthenticated,
    hasProfileError,
    hasTenantError,
    role,
  } = useCurrentUser();

  if (isLoadingAuth) {
    return <RouteFallback />;
  }

  if (isAuthenticated && (hasProfileError || hasTenantError)) {
    return <DefensiveLogout />;
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  if (!role || !roles.includes(role)) {
    // Área de volta: papéis de tenant têm o app; super_admin/sem papel caem na
    // raiz pública. A decisão usa só o `role` do servidor.
    const backTo =
      role === "admin" ||
      role === "professional" ||
      role === "receptionist"
        ? "/app"
        : "/";
    return <AccessDenied backTo={backTo} backLabel="Voltar ao início" />;
  }

  return <Outlet />;
}
