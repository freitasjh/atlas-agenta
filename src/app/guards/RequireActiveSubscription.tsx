import { Navigate, Outlet, useLocation } from "react-router-dom";

import { RouteFallback } from "@/components/RouteFallback";
import { DefensiveLogout } from "@/app/guards/DefensiveLogout";
import { ContaCanceladaPage } from "@/app/pages";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import type { SubscriptionStatus } from "@/types/domain";

/**
 * Guard de status de assinatura. O `subscription_status` chega pronto de
 * `useCurrentUser` (tenant do servidor, sob RLS) — nenhum `tenant_id` do
 * cliente. `switch` exaustivo sobre `SubscriptionStatus`: o `tsc` estrito acusa
 * se um status novo não for tratado.
 *
 * - Carregando → fallback.
 * - Sessão com profile ilegível → logout defensivo + `/login`.
 * - Tenant-user com tenant ilegível (`hasTenantError`) → logout defensivo, NUNCA
 *   liberar: senão um tenant `bloqueado`/`cancelado` cuja leitura falhe ganharia
 *   o app (anti "fail-open", CA-08.5).
 * - `super_admin` (sem tenant por construção) → passa. O router nunca roteia
 *   super_admin para `/app`; o acesso dele é decidido pelo RBAC de `/admin`.
 *   Liberar aqui é defensivo e não quebra com `tenant` null.
 * - `trial`/`ativo`/`pendente` → acesso normal (sem gating inventado para
 *   `pendente`).
 * - `bloqueado` → redireciona para a tela de quitação (`/app/quitacao`).
 * - `cancelado` → estado terminal "Conta cancelada" (`ContaCanceladaPage`).
 */
export function RequireActiveSubscription() {
  const location = useLocation();
  const {
    isLoadingAuth,
    isAuthenticated,
    hasProfileError,
    hasTenantError,
    isSuperAdmin,
    subscriptionStatus,
  } = useCurrentUser();

  if (isLoadingAuth) {
    return <RouteFallback />;
  }

  // Identidade ilegível (profile OU tenant): encerrar a sessão e sair. Cobrir o
  // tenant aqui é o que fecha o "fail-open" — sem isto, `hasTenantError` viraria
  // `subscriptionStatus === null` e cairia no ramo de super_admin abaixo.
  if (isAuthenticated && (hasProfileError || hasTenantError)) {
    return <DefensiveLogout />;
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  // super_admin não tem tenant: não há assinatura para avaliar. Só o super_admin
  // legítimo chega com `subscriptionStatus` null (o tenant-user com leitura
  // falha já foi barrado acima por `hasTenantError`).
  if (isSuperAdmin || subscriptionStatus === null) {
    return <Outlet />;
  }

  const status: SubscriptionStatus = subscriptionStatus;
  switch (status) {
    case "trial":
    case "ativo":
    case "pendente":
      return <Outlet />;
    case "bloqueado":
      return <Navigate to="/app/quitacao" replace />;
    case "cancelado":
      return <ContaCanceladaPage />;
    default: {
      // Exaustividade: se um status novo entrar em `SubscriptionStatus` sem
      // tratamento, o `tsc` estrito acusa aqui (nunca "fail-open" silencioso).
      const exhaustive: never = status;
      return exhaustive;
    }
  }
}
