import { useEffect } from "react";
import type { ReactNode } from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";

import { toast } from "sonner";

import { RouteFallback } from "@/components/RouteFallback";
import { AccessDenied } from "@/components/AccessDenied";
import { DefensiveLogout } from "@/app/guards/DefensiveLogout";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import type { Role } from "@/types/domain";

interface RequireRoleProps {
  /** Papéis autorizados a acessar as rotas filhas. */
  roles: Role[];
  /** Conteúdo a renderizar quando autorizado (uso inline em rotas folha). */
  children?: ReactNode;
}

/**
 * Guard de RBAC. O `role` vem SEMPRE de `useCurrentUser` (claim `user_role` do
 * JWT, ADR-07) — nunca de parâmetro do cliente; nenhum `tenant_id` é lido aqui.
 *
 * - Carregando → fallback.
 * - Sessão com identidade/tenant ilegível → logout defensivo + `/login`
 *   (anti "fail-open"); não libera acesso em erro.
 * - `role` fora de `roles` → tela 403 "Acesso restrito" (nomeada, sem redirect
 *   silencioso), com link para a área do papel: `admin`/`professional`/
 *   `receptionist` → `/app`; sem papel utilizável → `/`.
 * - `role` no conjunto → `<Outlet />`.
 *
 * Nota de fase futura: as telas de `cobrancas` (financeiro) deverão usar
 * `RequireRole roles={["admin"]}` para excluir `receptionist`/`professional`.
 */
export function RequireRole({ roles, children }: RequireRoleProps) {
  const location = useLocation();
  const {
    isLoadingAuth,
    isAuthenticated,
    hasIdentityError,
    hasTenantError,
    role,
  } = useCurrentUser();

  // Hook antes dos early returns (Rules of Hooks). O toast só dispara quando o
  // papel não autoriza a rota; a condição fica dentro do efeito.
  useEffect(() => {
    if (
      !isLoadingAuth &&
      isAuthenticated &&
      !hasIdentityError &&
      !hasTenantError &&
      (!role || !roles.includes(role))
    ) {
      toast.error("Acesso restrito.");
    }
  }, [isLoadingAuth, isAuthenticated, hasIdentityError, hasTenantError, role, roles]);

  if (isLoadingAuth) {
    return <RouteFallback />;
  }

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

  if (children) {
    return <>{children}</>;
  }

  return <Outlet />;
}
