import { useQuery } from "@tanstack/react-query";
import { z } from "zod";

import { supabase } from "@/lib/supabase";
import { getPlanLabel } from "@/lib/subscription-status";
import { PLAN_SLUGS, type PlanSlug } from "@/lib/plans";
import {
  SUBSCRIPTION_STATUSES,
  type SubscriptionStatus,
  type TenantListItem,
} from "@/types/domain";
import { WHATSAPP_CONNECTION_STATUSES } from "@/types/domain";

import { useAdminTenants } from "@/hooks/useAdminTenants";

/**
 * Hook de dados do dashboard do super admin (ADR-15) — somente leitura.
 *
 * Ponto de segurança: nenhuma query filtra por `tenant_id` (`.eq`); a trava é
 * o RLS `tenants_super_admin_select` (e equivalente para as demais tabelas lidas).
 * Toda resposta é dado não confiável e validada por zod antes do uso.
 */

export const ADMIN_DASHBOARD_TENANTS_KEY = ["admin", "dashboard", "tenants"] as const;
export const ADMIN_DASHBOARD_WHATSAPP_KEY = [
  "admin",
  "dashboard",
  "whatsapp-instances",
] as const;
export const ADMIN_DASHBOARD_APPOINTMENTS_KEY = [
  "admin",
  "dashboard",
  "appointments-month",
] as const;

/** Filtro de status no dashboard (mesmo vocabulário de `EmpresasFilters`). */
export type AdminTenantStatusFilter = SubscriptionStatus | "todos";

/** Filtro de plano no dashboard. */
export type AdminTenantPlanFilter = PlanSlug | "todos";

export interface AdminTenantFilters {
  status: AdminTenantStatusFilter;
  plan: AdminTenantPlanFilter;
}

/** KPIs derivados em memória a partir das linhas carregadas. */
export interface AdminDashboardKpis {
  total: number;
  byStatus: Record<SubscriptionStatus, number>;
  trialsExpiring7d: number;
  blocked: number;
  disconnectedWhatsApp: number;
  appointmentsThisMonth: number | null;
}

/** Linha retornada por `admin_dashboard_disconnected_whatsapp()` (RPC SECURITY DEFINER). */
export interface AdminDashboardDisconnectedWhatsApp {
  tenant_id: string;
  trade_name: string | null;
  connection_status: (typeof WHATSAPP_CONNECTION_STATUSES)[number];
  last_connected_at: string | null;
}

/** Schema zod da resposta de `admin_dashboard_disconnected_whatsapp()`. */
const adminDisconnectedWhatsAppRowSchema = z.object({
  tenant_id: z.string(),
  trade_name: z.string().nullable(),
  connection_status: z.enum(WHATSAPP_CONNECTION_STATUSES),
  last_connected_at: z.string().nullable(),
});

const adminDisconnectedWhatsAppResponseSchema = z.array(
  adminDisconnectedWhatsAppRowSchema,
);

/** Schema zod da resposta de `admin_dashboard_counts()` (pode ser null para não-super_admin). */
const adminDashboardCountsSchema = z
  .object({
    tenants_by_status: z.record(z.string(), z.number()).default({}),
    trials_expiring_7d: z.number().int(),
    blocked: z.number().int(),
    disconnected_whatsapp: z.number().int(),
    appointments_this_month: z.number().int(),
  })
  .nullable();

/**
 * Lista de instâncias de WhatsApp não conectadas (RPC SECURITY DEFINER, cross-tenant
 * apenas para super_admin). Sem `.eq("tenant_id", ...)`: a trava é a função.
 */
export function useAdminWhatsAppInstances() {
  return useQuery<AdminDashboardDisconnectedWhatsApp[]>({
    queryKey: ADMIN_DASHBOARD_WHATSAPP_KEY,
    queryFn: async () => {
      const { data, error } = await supabase.rpc(
        "admin_dashboard_disconnected_whatsapp",
      );
      if (error) throw error;
      return adminDisconnectedWhatsAppResponseSchema.parse(data ?? []);
    },
  });
}

/**
 * Contagem de agendamentos criados no mês corrente (opcional — depende de RLS
 * permitir leitura cross-tenant). Devolve `null` quando indisponível, sem
 * lançar, para a UI exibir "—".
 */
export function useAdminAppointmentsMonthCount() {
  return useQuery<number | null>({
    queryKey: ADMIN_DASHBOARD_APPOINTMENTS_KEY,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_dashboard_counts");
      if (error) return null;
      const parsed = adminDashboardCountsSchema.safeParse(data);
      if (!parsed.success) return null;
      return parsed.data?.appointments_this_month ?? null;
    },
  });
}

/** Reexporta o hook de tenants para o dashboard (mesma fonte de verdade). */
export function useAdminDashboardTenants() {
  return useAdminTenants();
}

/**
 * Filtra empresas por status e plano (client-side, como `EmpresasPage`).
 * Combinado por AND. Exportado para testes unitários.
 */
export function filterAdminTenants(
  tenants: TenantListItem[],
  filters: AdminTenantFilters,
): TenantListItem[] {
  return tenants.filter((tenant) => {
    const statusMatch =
      filters.status === "todos" || tenant.subscription_status === filters.status;
    if (!statusMatch) return false;
    const planMatch =
      filters.plan === "todos" || tenant.plan === filters.plan;
    return planMatch;
  });
}

/** Alias mais descritivo para os testes de filtros (status + plano). */
export function filterTenantsByStatusAndPlan(
  tenants: TenantListItem[],
  status: AdminTenantStatusFilter,
  plan: AdminTenantPlanFilter,
): TenantListItem[] {
  return filterAdminTenants(tenants, { status, plan });
}

/** Alias curto. */
export function filterTenants(
  tenants: TenantListItem[],
  status: AdminTenantStatusFilter,
  plan: AdminTenantPlanFilter,
): TenantListItem[] {
  return filterTenantsByStatusAndPlan(tenants, status, plan);
}

/**
 * Computa os KPIs do dashboard a partir das linhas carregadas. Exportado para
 * testes unitários. `appointmentsThisMonth` é injetado pelo chamador (pode ser
 * `null` quando indisponível).
 */
export function computeAdminKpis(
  tenants: TenantListItem[],
  instances: AdminDashboardDisconnectedWhatsApp[],
  appointmentsThisMonth: number | null = null,
): AdminDashboardKpis {
  const byStatus = SUBSCRIPTION_STATUSES.reduce(
    (acc, status) => {
      acc[status] = 0;
      return acc;
    },
    {} as Record<SubscriptionStatus, number>,
  );
  for (const tenant of tenants) {
    byStatus[tenant.subscription_status] += 1;
  }

  const now = Date.now();
  const sevenDays = 7 * 24 * 60 * 60 * 1000;
  let trialsExpiring7d = 0;
  for (const tenant of tenants) {
    if (tenant.subscription_status !== "trial") continue;
    if (!tenant.trial_ends_at) continue;
    const end = new Date(tenant.trial_ends_at).getTime();
    if (Number.isNaN(end)) continue;
    if (end >= now && end <= now + sevenDays) trialsExpiring7d += 1;
  }

  const blocked = byStatus.bloqueado ?? 0;

  const disconnectedWhatsApp = instances.filter(
    (instance) => instance.connection_status !== "conectado",
  ).length;

  return {
    total: tenants.length,
    byStatus,
    trialsExpiring7d,
    blocked,
    disconnectedWhatsApp,
    appointmentsThisMonth,
  };
}

/** Reexporta rótulos para a UI (evita import duplicado). */
export { getPlanLabel, PLAN_SLUGS };
