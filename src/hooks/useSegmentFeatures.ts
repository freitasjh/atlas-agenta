import { useCurrentUser } from "@/hooks/useCurrentUser";
import {
  resolveFeatures,
  type SegmentFeatures,
} from "@/lib/segment-features";

/**
 * Recursos de domínio por ramo para a UI (ADR-05, Fase 1b). Hook fino, irmão de
 * `useSegmentTerms`, que lê o `segment` do tenant **já carregado** por
 * `useCurrentUser()` (que encadeia `useTenant` sob RLS) e devolve as flags
 * resolvidas.
 *
 * **Sem request próprio:** reusa o cache TanStack Query do tenant, respeitando
 * "dados de servidor via TanStack Query, nada de `fetch` solto". Durante o load
 * do tenant (ou para `super_admin` sem tenant), `tenant` é `null` e o hook
 * devolve tudo desligado — nunca `undefined`, nunca flash (o recurso aparece só
 * depois que o ramo resolve, nunca pisca ligado antes).
 *
 * O gating é só de UI (PRD §4): a trava real de acesso a dados é o RLS por
 * `tenant_id` / `professional_id`, nunca `segment`. O ramo vem sempre do banco
 * sob RLS, nunca de parâmetro do cliente.
 */
export function useSegmentFeatures(): SegmentFeatures {
  const { tenant } = useCurrentUser();
  return resolveFeatures(tenant?.segment ?? null);
}
