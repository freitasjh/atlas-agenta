import { useQuery } from "@tanstack/react-query";
import { z } from "zod";

import { supabase } from "@/lib/supabase";
import { PLAN_SLUGS } from "@/lib/plans";

/**
 * Leitura das divergências charge paga × plano do tenant
 * (backoffice-plan-control, hardening C1).
 *
 * Único caminho: RPC `admin_get_plan_divergences` (super_admin, guard
 * interno). A view `v_charges_pagas_sem_plano` é `security_invoker` e está
 * revogada para anon/authenticated — nenhum select direto nela.
 * Resposta é dado não confiável: validada por zod antes do uso.
 */

export const planDivergenceRowSchema = z.object({
  charge_id: z.string().uuid(),
  tenant_id: z.string().uuid(),
  charge_plan: z.enum(PLAN_SLUGS).nullable(),
  current_plan: z.enum(PLAN_SLUGS),
  amount_cents: z.number(),
  paid_at: z.string().nullable(),
});

export type PlanDivergenceRow = z.infer<typeof planDivergenceRowSchema>;

export const planDivergenceListSchema = z.array(planDivergenceRowSchema);

export const PLAN_DIVERGENCES_KEY = ["admin", "plan-divergences"] as const;

export function usePlanDivergences() {
  return useQuery<PlanDivergenceRow[]>({
    queryKey: PLAN_DIVERGENCES_KEY,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_get_plan_divergences");
      if (error) throw error;
      return planDivergenceListSchema.parse(data ?? []);
    },
  });
}
