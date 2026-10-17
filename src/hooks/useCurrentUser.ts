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
  /**
   * True quando há sessão mas o profile não pôde ser lido (RLS nega, linha
   * ausente ou falha de rede). Sinaliza aos guards (ADR-08) o logout defensivo:
   * sessão sem profile legível é "não autorizado", nunca acesso liberado.
   */
  hasProfileError: boolean;
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

  // Sessão viva mas o profile não carregou (RLS nega / linha ausente / rede):
  // não é usuário anônimo, é falha de autorização. Os guards reagem com logout
  // defensivo em vez de liberar acesso (postura anti "fail-open").
  const hasProfileError = !!session && profileQuery.isError;

  return {
    isLoadingAuth,
    session,
    role,
    tenant,
    subscriptionStatus: tenant?.subscription_status ?? null,
    isAuthenticated: !!session,
    isSuperAdmin,
    hasProfileError,
  };
}
