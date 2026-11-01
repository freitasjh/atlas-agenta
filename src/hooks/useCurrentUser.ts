import type { AuthSession } from "@supabase/supabase-js";

import { useAuthClaims } from "@/hooks/useAuthClaims";
import { useSession } from "@/hooks/useSession";
import { useTenant } from "@/hooks/useTenant";
import type {
  CurrentTenant,
  Role,
  SubscriptionStatus,
} from "@/types/domain";

/** Estado consolidado de identidade que os guards e o chrome consomem. */
export interface CurrentUser {
  /** True enquanto a sessão (ou o tenant, quando há um) ainda não resolveu. */
  isLoadingAuth: boolean;
  session: AuthSession | null;
  /** `session.user.id` — a mesma identidade da claim `sub`. */
  userId: string | null;
  role: Role | null;
  /** Empresa da claim `tenant_id`; `null` para `super_admin`. */
  tenantId: string | null;
  /** Claim `must_change_password` (ADR-01); `false` sem claims. */
  mustChangePassword: boolean;
  tenant: CurrentTenant | null;
  subscriptionStatus: SubscriptionStatus | null;
  isAuthenticated: boolean;
  isSuperAdmin: boolean;
  /**
   * True quando há sessão mas as claims de identidade estão ausentes ou
   * inválidas (token emitido antes do hook, claim fora do enum, flag não
   * booleana). Sinaliza aos guards (ADR-08) o logout defensivo: sessão sem
   * identidade confiável é "não autorizado", nunca acesso liberado.
   */
  hasIdentityError: boolean;
  /**
   * True quando as claims têm `tenant_id` mas a leitura do tenant falhou (RLS
   * nega a linha ou falha de rede). Distingue "super_admin legítimo sem tenant"
   * (tenant null por desenho) de "tenant-user cuja assinatura não pôde ser
   * lida". Sem este flag, o segundo caso cairia em `subscriptionStatus === null`
   * e o guard liberaria acesso — exatamente o "fail-open" que a ADR proíbe.
   */
  hasTenantError: boolean;
}

/**
 * Agregador de identidade para os guards (ADR-08) e o chrome. A identidade vem
 * das claims do JWT (ADR-07) — nenhuma leitura de `profiles` no caminho de
 * carregamento. O dado de negócio do tenant continua vindo do banco sob RLS.
 */
export function useCurrentUser(): CurrentUser {
  const sessionQuery = useSession();
  const claims = useAuthClaims();
  const tenantQuery = useTenant();

  const session = sessionQuery.data ?? null;
  const userId = session?.user.id ?? null;
  const role = claims?.role ?? null;
  const tenantId = claims?.tenantId ?? null;
  const isSuperAdmin = role === "super_admin";

  // `super_admin` não tem tenant: o hook de tenant fica desabilitado e nunca
  // entra em `pending` de verdade, então não deve contar como carregando.
  const tenant = tenantQuery.data ?? null;

  // Sessão viva mas sem claims válidas: não é usuário anônimo, é falha de
  // autorização. Os guards reagem com logout defensivo em vez de liberar
  // acesso (postura anti "fail-open"). Sessões antigas caem aqui uma vez.
  const hasIdentityError = !!session && claims === null;

  const isLoadingAuth =
    sessionQuery.isLoading ||
    (!hasIdentityError && !!tenantId && tenantQuery.isLoading);

  // Claims com `tenant_id`, mas o tenant não carregou: a assinatura é
  // ilegível. Não pode virar `subscriptionStatus === null` e liberar acesso —
  // um tenant `bloqueado`/`cancelado` cuja leitura falhe ganharia o app. Os
  // guards tratam como falha de autorização (logout defensivo).
  const hasTenantError = !!tenantId && tenantQuery.isError;

  return {
    isLoadingAuth,
    session,
    userId,
    role,
    tenantId,
    mustChangePassword: claims?.mustChangePassword ?? false,
    tenant,
    subscriptionStatus: tenant?.subscription_status ?? null,
    isAuthenticated: !!session,
    isSuperAdmin,
    hasIdentityError,
    hasTenantError,
  };
}
