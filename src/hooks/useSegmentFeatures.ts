import { useCurrentUser } from "@/hooks/useCurrentUser";
import {
  resolveFeatures,
  type SegmentFeatures,
} from "@/lib/segment-features";

/**
 * Recursos de domínio por ramo para a UI (ADR-05, Fase 1b; ADR-004 para
 * `payments`). Hook fino, irmão de `useSegmentTerms`, que lê o `segment` do
 * tenant **já carregado** por `useCurrentUser()` (que encadeia `useTenant` sob
 * RLS) e devolve as flags resolvidas.
 *
 * **Sem request próprio:** reusa o cache TanStack Query do tenant, respeitando
 * "dados de servidor via TanStack Query, nada de `fetch` solto". Durante o load
 * do tenant (ou para `super_admin` sem tenant), `tenant` é `null` e o hook
 * devolve `payments: null` — "não resolvido", distinto de "desligado" (D5).
 * Nunca cai no fluxo legado antes de o ramo resolver.
 *
 * O gating é só de UI (PRD §4): a trava real de acesso a dados é o RLS por
 * `tenant_id` / `professional_id`, nunca `segment`.
 */
export function useSegmentFeatures(): SegmentFeatures {
  const { tenant, isLoadingAuth, hasTenantError } = useCurrentUser();
  // "Resolvido" exige sessão carregada **e** tenant legível. Com erro de
  // leitura o ramo é desconhecido ⇒ `payments: null` (nunca "desligado").
  const tenantResolved = !isLoadingAuth && !hasTenantError;
  return resolveFeatures(tenant?.segment ?? null, tenantResolved);
}
