import { z } from "npm:zod@3.23.8";
import { PLAN_SLUGS, type PlanSlug } from "../_shared/plans.ts";

/**
 * `plan` é validado contra os slugs reais de `shared/plans.json` (fonte única)
 * — slug desconhecido é 400, nunca um preço default silencioso. `annual` não
 * existe em `PLANS` (sem regra de desconto definida), então só `monthly` é
 * aceito; `annual` é rejeitado em vez de inventar `mensal * 10`.
 */
export const requestSchema = z.object({
  tenant_id: z.string().uuid(),
  plan: z.enum(PLAN_SLUGS as [PlanSlug, ...PlanSlug[]]),
  billing_period: z.literal("monthly").default("monthly"),
});
export type RequestInput = z.infer<typeof requestSchema>;
