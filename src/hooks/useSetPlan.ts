import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";

import { supabase } from "@/lib/supabase";
import {
  changePlanResponseSchema,
  tenantPlanUsageSchema,
  type ChangePlanResponse,
  type TenantPlanUsage,
} from "@/lib/validations/admin-plan";
import type { PlanSlug } from "@/lib/plans";

/**
 * Hooks de dados da troca de plano auditada (backoffice-plan-control).
 * Escrita SOMENTE via Edge Function `admin-plan` (service role no servidor).
 * Nenhum UPDATE direto de `tenants.plan` pelo cliente.
 */

export const ADMIN_PLAN_USAGE_KEY = (tenantId: string) =>
  ["admin", "plan-usage", tenantId] as const;

/** Leitura do uso atual via RPC `admin_get_tenant_plan` (super_admin, RLS guarda). */
export function useTenantPlanUsage(tenantId: string | null) {
  return useQuery<TenantPlanUsage>({
    queryKey: tenantId ? ADMIN_PLAN_USAGE_KEY(tenantId) : ["admin", "plan-usage", "none"],
    enabled: Boolean(tenantId),
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_get_tenant_plan", {
        p_tenant_id: tenantId,
      });
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;
      return tenantPlanUsageSchema.parse(row);
    },
  });
}

export interface SetTenantPlanInput {
  tenantId: string;
  plan: PlanSlug;
  reason: string;
  override?: boolean;
}

export interface AdminPlanError extends Error {
  status?: number;
}

export async function normalizePlanInvokeError(error: unknown): Promise<AdminPlanError> {
  let status: number | undefined;
  let bodyText = "";
  if (typeof error === "object" && error !== null && "context" in error) {
    const context = (error as { context: unknown }).context;
    if (typeof context === "object" && context !== null) {
      const maybeStatus = (context as { status?: unknown }).status;
      if (typeof maybeStatus === "number") status = maybeStatus;
      if (typeof (context as { json?: unknown }).json === "function") {
        try {
          const body = await (context as { json: () => Promise<unknown> }).json();
          if (typeof body === "object" && body !== null && "error" in body) {
            const value = (body as { error: unknown }).error;
            if (typeof value === "string") bodyText = value;
          }
        } catch {
          // Corpo ilegível: mantém status + mensagem original.
        }
      }
    }
  }
  const originalMessage =
    typeof error === "object" && error !== null && "message" in error
      ? String((error as { message: unknown }).message ?? "")
      : "";
  const message = [status !== undefined ? String(status) : "", bodyText, originalMessage]
    .filter((part) => part.length > 0)
    .join(" ")
    .trim();
  const normalized: AdminPlanError = new Error(
    message.length > 0 ? message : "admin-plan invoke failed",
  );
  if (status !== undefined) normalized.status = status;
  return normalized;
}

/** Limites de apresentação (espelham o banco; a trava canônica é o servidor). */
export const PLAN_PRESENTATION_LIMITS: Record<PlanSlug, { prof: number | null; appt: number | null }> = {
  individual: { prof: 1, appt: 150 },
  clinica: { prof: 5, appt: null },
  pro: { prof: null, appt: null },
};

/** True quando o uso atual estoura o plano destino (bloqueia Confirmar sem override). */
export function isUsageOverPlan(
  usage: Pick<TenantPlanUsage, "active_professionals" | "month_appointments"> | null | undefined,
  dest: PlanSlug,
): boolean {
  if (!usage) return false;
  const limits = PLAN_PRESENTATION_LIMITS[dest];
  if (limits.prof !== null && usage.active_professionals > limits.prof) return true;
  if (limits.appt !== null && usage.month_appointments > limits.appt) return true;
  return false;
}

/** Troca de plano via Edge Function. Invalida lista + uso em sucesso; nada em erro. */
export function useSetTenantPlan() {
  const queryClient = useQueryClient();
  return useMutation<ChangePlanResponse, Error, SetTenantPlanInput>({
    mutationFn: async (input) => {
      const parsed = z
        .object({
          tenantId: z.string().uuid(),
          plan: z.enum(["individual", "clinica", "pro"] as const),
          reason: z.string().trim().min(10).max(280),
          override: z.boolean().optional(),
        })
        .parse(input);
      const { data, error } = await supabase.functions.invoke("admin-plan", {
        body: {
          action: "set_plan",
          tenantId: parsed.tenantId,
          plan: parsed.plan,
          reason: parsed.reason,
          override: parsed.override ?? false,
        },
      });
      if (error) throw await normalizePlanInvokeError(error);
      return changePlanResponseSchema.parse(data);
    },
    onSuccess: (data) => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "tenants"] });
      void queryClient.invalidateQueries({
        queryKey: ADMIN_PLAN_USAGE_KEY(data.tenant_id),
      });
      void queryClient.invalidateQueries({ queryKey: ["admin", "plan-history", data.tenant_id] });
    },
  });
}
