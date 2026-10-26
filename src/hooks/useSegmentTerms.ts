import { useCurrentUser } from "@/hooks/useCurrentUser";
import { resolveTerms, type SegmentTerms } from "@/lib/segment-presets";

/**
 * Terminologia por ramo para a UI (ADR-05). Hook fino que lê o `segment` do
 * tenant **já carregado** por `useCurrentUser()` (que encadeia `useTenant` sob
 * RLS) e devolve os termos resolvidos.
 *
 * **Sem request próprio:** reusa o cache TanStack Query do tenant, respeitando
 * "dados de servidor via TanStack Query, nada de `fetch` solto". Durante o load
 * do tenant (ou para `super_admin` sem tenant), `tenant` é `null` e o hook
 * devolve os termos genéricos — nunca `undefined`, nunca flash.
 *
 * Único ponto que importa `segment-presets`: os componentes consomem só este
 * hook, mantendo uma única fonte de resolução (e do fallback). O `segment` vem
 * sempre do banco sob RLS, nunca de parâmetro do cliente.
 */
export function useSegmentTerms(): SegmentTerms {
  const { tenant } = useCurrentUser();
  return resolveTerms(tenant?.segment ?? null);
}
