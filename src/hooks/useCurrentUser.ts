import type { AuthSession } from "@supabase/supabase-js";

import { useSession } from "@/hooks/useSession";
import { useProfile } from "@/hooks/useProfile";
import { useTenant } from "@/hooks/useTenant";
import type {
  CurrentTenant,
  Role,
  SubscriptionStatus,
} from "@/types/domain";

/** Estado consolidado de identidade que os guards e o chrome consomem. */
export interface CurrentUser {
  /** True enquanto a cadeia sessão → profile → tenant ainda não resolveu. */
  isLoadingAuth: boolean;
  session: AuthSession | null;
  role: Role | null;
  tenant: CurrentTenant | null;
  subscriptionStatus: SubscriptionStatus | null;
  isAuthenticated: boolean;
  isSuperAdmin: boolean;
}

/**
 * Agregador que orquestra sessão → profile → tenant, para os guards (ADR-08) e
 * o chrome não repetirem o encadeamento. Deriva flags prontas de autenticação
 * e papel. Nunca lê nem envia `tenant_id` do cliente — tudo vem do servidor sob
 * RLS.
 */
export function useCurrentUser(): CurrentUser {
  const sessionQuery = useSession();
  const profileQuery = useProfile();
  const tenantQuery = useTenant();

  const session = sessionQuery.data ?? null;
  const profile = profileQuery.data ?? null;
  const role = profile?.role ?? null;
  const isSuperAdmin = role === "super_admin";

  // `super_admin` não tem tenant: o hook de tenant fica desabilitado e nunca
  // entra em `pending` de verdade, então não deve contar como carregando.
  const tenant = tenantQuery.data ?? null;

  const isLoadingAuth =
    sessionQuery.isLoading ||
    (!!session && profileQuery.isLoading) ||
    (!!profile?.tenant_id && tenantQuery.isLoading);

  return {
    isLoadingAuth,
    session,
    role,
    tenant,
    subscriptionStatus: tenant?.subscription_status ?? null,
    isAuthenticated: !!session,
    isSuperAdmin,
  };
}
