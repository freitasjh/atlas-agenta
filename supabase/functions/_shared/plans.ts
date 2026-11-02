/**
 * Preço de plano — leitura da fonte única `shared/plans.json` (ADR-13/ADR-20).
 *
 * O mesmo JSON alimenta `src/lib/plans.ts` no frontend. Aqui só o que o
 * servidor precisa: slug válido e valor em centavos. Rótulo, público e
 * destaques são apresentacionais e não existem neste lado da fronteira.
 */
import planPrices from "../../../shared/plans.json" with { type: "json" };

export type PlanSlug = keyof typeof planPrices;

/** Slugs aceitos, derivados das chaves do JSON (nunca de lista paralela). */
export const PLAN_SLUGS = Object.keys(planPrices) as PlanSlug[];

/** Valor mensal em centavos por slug. */
export const PLAN_PRICE_CENTS: Record<PlanSlug, number> = planPrices;

export function planPriceCents(plan: PlanSlug): number {
  return PLAN_PRICE_CENTS[plan];
}
