import { useQuery } from "@tanstack/react-query";
import { z } from "zod";

import { supabase } from "@/lib/supabase";
import { planCatalogRowSchema } from "@/lib/plans";

/**
 * Limites (quotas) do plano vigente no catálogo SSoT (`get_plans()`).
 *
 * Separado do `usePlansCatalog` (camada apresentacional sem limites) porque o
 * card "uso vs quota" precisa de `prof_limit`/`appt_limit` brutos. `null` =
 * ausente/fora do catálogo/falha: o chamador degrada, nunca trava. Nunca lança.
 */

export interface PlanLimits {
  profLimit: number | null;
  apptLimit: number | null;
}

const catalogRowsSchema = z.array(planCatalogRowSchema);

export const PLAN_LIMITS_KEY = ["plans", "limits"] as const;

async function fetchPlanLimits(planSlug: string): Promise<PlanLimits | null> {
  try {
    const { data, error } = await supabase.rpc("get_plans");
    if (error) return null;
    const rows = catalogRowsSchema.parse(data);
    const row = rows.find((r) => r.slug === planSlug && r.active);
    if (!row) return null;
    return { profLimit: row.prof_limit, apptLimit: row.appt_limit };
  } catch {
    return null;
  }
}

export function usePlanLimits(
  planSlug: string | null,
  options?: { enabled?: boolean },
): { limits: PlanLimits | null; isLoading: boolean } {
  const enabled = (options?.enabled ?? true) && planSlug !== null;
  const query = useQuery<PlanLimits | null>({
    queryKey: [...PLAN_LIMITS_KEY, planSlug],
    queryFn: () => fetchPlanLimits(planSlug as string),
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    retry: false,
    enabled,
  });
  return {
    limits: enabled ? (query.data ?? null) : null,
    isLoading: enabled && query.isLoading,
  };
}
