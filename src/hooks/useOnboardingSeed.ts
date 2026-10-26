import { useEffect, useRef } from "react";

import { useCurrentUser } from "@/hooks/useCurrentUser";
import { usePermissions } from "@/hooks/usePermissions";
import { useServices, useCreateService } from "@/hooks/useServices";
import { resolveSeedServices } from "@/lib/segment-presets";

/**
 * Onboarding client-side do catálogo de `services` por ramo (ADR-06 / RF-10).
 *
 * No **primeiro acesso** de um tenant sem nenhum serviço, aplica o catálogo
 * típico do ramo (`SEGMENT_SEED_SERVICES`) via as mutations normais de
 * `services` — sob `services_write_admin`, com `tenant_id` derivado de
 * `current_tenant_id()` no banco. O cliente **nunca** envia `tenant_id`; o
 * isolamento é do RLS, não do `segment`. Nenhuma operação privilegiada
 * (service role) — só anon key + sessão.
 *
 * Disparo (todas as condições juntas):
 *   - usuário com `canManageCatalog` (admin) — professional/receptionist não
 *     semeiam;
 *   - `segment` conhecido (ramo resolve uma lista não vazia; legado/`null` não);
 *   - a lista de `services` já **carregou com sucesso** e está **vazia**.
 *
 * **Idempotência:** só dispara quando a lista carregou e está vazia; se já
 * houver qualquer serviço, não reaplica. Um flag em memória por `tenant_id`
 * evita disparo duplo na mesma sessão enquanto a invalidação do cache não
 * volta (janela entre o insert e o refetch em que a lista ainda parece vazia).
 *
 * **Fail-safe:** qualquer falha de mutation é silenciosa — nada é lançado ao
 * usuário e o signup não é afetado. A `ServicosPage` continua mostrando o
 * estado vazio honesto existente se o seed não for aplicado.
 */
export function useOnboardingSeed(): void {
  const { tenant } = useCurrentUser();
  const { canManageCatalog } = usePermissions();
  const servicesQuery = useServices();
  const createService = useCreateService();

  const tenantId = tenant?.id ?? null;
  const segment = tenant?.segment ?? null;

  // Flag por tenant: o seed só pode rodar uma vez por sessão para um dado
  // tenant, mesmo durante a janela entre o insert e o refetch do cache.
  const seededTenantRef = useRef<string | null>(null);

  useEffect(() => {
    if (!canManageCatalog) return;
    if (!tenantId) return;

    const seedServices = resolveSeedServices(segment);
    if (seedServices.length === 0) return; // legado/`null`: estado vazio honesto.

    // Só semeia quando a lista carregou com sucesso E está vazia.
    if (servicesQuery.isLoading || servicesQuery.isError) return;
    if (!servicesQuery.isSuccess) return;
    if ((servicesQuery.data?.length ?? 0) > 0) return;

    // Já semeado nesta sessão para este tenant? Não reaplica.
    if (seededTenantRef.current === tenantId) return;
    seededTenantRef.current = tenantId;

    // Aplica o catálogo via as mutations normais (sob RLS do admin). Falha é
    // silenciosa: a tela degrada para o estado vazio honesto, sem erro.
    for (const service of seedServices) {
      createService.mutate({
        name: service.name,
        durationMinutes: service.durationMinutes,
        priceCents: service.priceCents,
        active: true,
      });
    }
  }, [
    canManageCatalog,
    tenantId,
    segment,
    servicesQuery.isLoading,
    servicesQuery.isError,
    servicesQuery.isSuccess,
    servicesQuery.data,
    createService,
  ]);
}
