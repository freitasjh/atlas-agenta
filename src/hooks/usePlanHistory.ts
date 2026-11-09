import { useQuery } from "@tanstack/react-query";
import { z } from "zod";

import { supabase } from "@/lib/supabase";
import { PLAN_SLUGS } from "@/lib/plans";

/** Linha da auditoria `tenant_plan_changes` (append-only, super_admin). */
export const planChangeRowSchema = z.object({
  id: z.string().uuid(),
  tenant_id: z.string().uuid(),
  changed_by: z.string().uuid().nullable(),
  old_plan: z.enum(PLAN_SLUGS),
  new_plan: z.enum(PLAN_SLUGS),
  reason: z.string(),
  override_flag: z.boolean(),
  created_at: z.string(),
});

export type PlanChangeRow = z.infer<typeof planChangeRowSchema>;

export const ADMIN_PLAN_HISTORY_KEY = (tenantId: string) =>
  ["admin", "plan-history", tenantId] as const;

export function usePlanHistory(tenantId: string | null) {
  return useQuery<PlanChangeRow[]>({
    queryKey: tenantId ? ADMIN_PLAN_HISTORY_KEY(tenantId) : ["admin", "plan-history", "none"],
    enabled: Boolean(tenantId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tenant_plan_changes")
        .select("id, tenant_id, changed_by, old_plan, new_plan, reason, override_flag, created_at")
        .eq("tenant_id", tenantId as string)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return z.array(planChangeRowSchema).parse(data ?? []);
    },
  });
}
