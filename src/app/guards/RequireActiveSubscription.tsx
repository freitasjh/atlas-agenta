import { Navigate, Outlet, useLocation } from "react-router-dom";

import { Skeleton } from "@/components/ui/skeleton";
import { Logo } from "@/components/Logo";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import type { SubscriptionStatus } from "@/types/domain";

function RouteFallback() {
  return (
    <div className="flex min-h-screen flex-col gap-4 p-6" aria-hidden="true">
      <Skeleton className="h-10 w-40" />
      <Skeleton className="h-64 w-full" />
    </div>
  );
}

/**
 * Estado terminal mínimo para `cancelado`. A tela definitiva (arquivamento,
 * contato comercial) é materializada na ADR-09; aqui só garantimos que o acesso
 * operacional é barrado sem quebrar o build.
 */
function AccountCancelled() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-background px-4 text-center text-foreground">
      <Logo />
      <div className="space-y-2">
        <h1 className="font-display text-3xl font-semibold tracking-tight">
          Conta cancelada
        </h1>
        <p className="mx-auto max-w-md text-sm text-muted-foreground">
          Esta conta foi cancelada e o acesso às operações está suspenso. Para
          reativá-la, fale com o nosso time.
        </p>
      </div>
    </div>
  );
}

/**
 * Guard de status de assinatura. O `subscription_status` chega pronto de
 * `useCurrentUser` (tenant do servidor, sob RLS) — nenhum `tenant_id` do
 * cliente. `switch` exaustivo sobre `SubscriptionStatus`: o `tsc` estrito acusa
 * se um status novo não for tratado.
 *
 * - Carregando → fallback.
 * - Sessão sem profile legível → não autorizado: `/login` (anti "fail-open").
 * - `super_admin` (sem tenant) → passa (defensivo: não quebra com `tenant`
 *   null).
 * - `trial`/`ativo`/`pendente` → acesso normal (sem gating inventado para
 *   `pendente`).
 * - `bloqueado` → redireciona para a tela de quitação (`/app/quitacao`,
 *   materializada na ADR-09).
 * - `cancelado` → estado terminal "Conta cancelada".
 */
export function RequireActiveSubscription() {
  const location = useLocation();
  const {
    isLoadingAuth,
    isAuthenticated,
    hasProfileError,
    isSuperAdmin,
    subscriptionStatus,
  } = useCurrentUser();

  if (isLoadingAuth) {
    return <RouteFallback />;
  }

  if (!isAuthenticated || hasProfileError) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  // super_admin não tem tenant: não há assinatura para avaliar. Liberar aqui é
  // coerente (o RBAC de `/admin` é quem decide o acesso dele).
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
      return <AccountCancelled />;
    default: {
      // Exaustividade: se um status novo entrar em `SubscriptionStatus` sem
      // tratamento, o `tsc` estrito acusa aqui (nunca "fail-open" silencioso).
      const exhaustive: never = status;
      return exhaustive;
    }
  }
}
