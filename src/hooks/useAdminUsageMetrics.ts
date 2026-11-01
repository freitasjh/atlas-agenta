import { useQuery } from "@tanstack/react-query";
import { z } from "zod";

import { supabase } from "@/lib/supabase";
import {
  SUBSCRIPTION_STATUSES,
  type SubscriptionStatus,
  type TenantListItem,
} from "@/types/domain";
import { PLAN_SLUGS, type PlanSlug } from "@/lib/plans";

/**
 * Hook de métricas de uso do super admin (ADR-18) — somente leitura.
 * RPCs SECURITY DEFINER cross-tenant; trava é `current_role_name() = 'super_admin'`.
 */

export const ADMIN_USAGE_OVERVIEW_KEY = ["admin", "usage", "overview"] as const;
export const ADMIN_USAGE_SERIES_KEY = ["admin", "usage", "series"] as const;
export const ADMIN_USAGE_TENANTS_KEY = ["admin", "usage", "tenants"] as const;

export type UsageBucket = "day" | "week" | "month";

export interface UsageOverviewRetention {
  active: number;
  cancelled: number;
  rate: number;
}

export interface UsageOverview {
  total_appointments: number;
  no_show_rate: number;
  confirmation_rate: number;
  whatsapp_usage: number;
  new_tenants: number;
  retention: UsageOverviewRetention;
}

export interface UsageSeriesPoint {
  bucket: string;
  appointments: number;
  no_show: number;
  confirmed: number;
}

export interface UsageTenantRow {
  tenant_id: string;
  trade_name: string | null;
  appointments: number;
  no_show: number;
  whatsapp: number;
}

const retentionSchema = z.object({
  active: z.number().int(),
  cancelled: z.number().int(),
  rate: z.number(),
});

const overviewSchema = z
  .object({
    total_appointments: z.number().int(),
    no_show_rate: z.number(),
    confirmation_rate: z.number(),
    whatsapp_usage: z.number().int(),
    new_tenants: z.number().int(),
    retention: retentionSchema,
  })
  .nullable();

const seriesRowSchema = z.object({
  bucket: z.string(),
  appointments: z.number().int(),
  no_show: z.number().int(),
  confirmed: z.number().int(),
});

const seriesResponseSchema = z.array(seriesRowSchema);

const tenantRowSchema = z.object({
  tenant_id: z.string(),
  trade_name: z.string().nullable(),
  appointments: z.number().int(),
  no_show: z.number().int(),
  whatsapp: z.number().int(),
});

const tenantResponseSchema = z.array(tenantRowSchema);

function parseIsoDate(value: string): Date | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [y, m, d] = value.split("-").map((part) => Number(part));
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return null;
  if (date.getUTCFullYear() !== y || date.getUTCMonth() + 1 !== m || date.getUTCDate() !== d) {
    return null;
  }
  return date;
}

export function isValidDate(value: string): boolean {
  return parseIsoDate(value) !== null;
}

export function isDateRangeValid(start: string, end: string): boolean {
  const s = parseIsoDate(start);
  const e = parseIsoDate(end);
  if (!s || !e) return false;
  return s.getTime() <= e.getTime();
}

/** Alias mais descritivo (compatibilidade com convenção do dashboard). */
export const isValidDateRange = isDateRangeValid;

export function toTimestamp(dateStr: string, endOfDay = false): string | null {
  const parsed = parseIsoDate(dateStr);
  if (!parsed) return null;
  const base = endOfDay
    ? `${dateStr}T23:59:59.999Z`
    : `${dateStr}T00:00:00.000Z`;
  const date = new Date(base);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

export function useAdminUsageOverview(start: string, end: string) {
  return useQuery<UsageOverview | null>({
    queryKey: [...ADMIN_USAGE_OVERVIEW_KEY, start, end],
    queryFn: async () => {
      const pStart = toTimestamp(start);
      const pEnd = toTimestamp(end, true);
      if (!pStart || !pEnd) return null;
      if (!isDateRangeValid(start, end)) return null;
      const { data, error } = await supabase.rpc("admin_usage_overview", {
        p_start: pStart,
        p_end: pEnd,
      });
      if (error) throw error;
      const parsed = overviewSchema.safeParse(data);
      if (!parsed.success) return null;
      return parsed.data;
    },
    enabled: Boolean(start && end && isDateRangeValid(start, end)),
  });
}

export function useAdminUsageSeries(start: string, end: string, bucket: UsageBucket) {
  return useQuery<UsageSeriesPoint[]>({
    queryKey: [...ADMIN_USAGE_SERIES_KEY, start, end, bucket],
    queryFn: async () => {
      const pStart = toTimestamp(start);
      const pEnd = toTimestamp(end, true);
      if (!pStart || !pEnd || !isDateRangeValid(start, end)) return [];
      const { data, error } = await supabase.rpc("admin_usage_series", {
        p_start: pStart,
        p_end: pEnd,
        p_bucket: bucket,
      });
      if (error) throw error;
      const parsed = seriesResponseSchema.safeParse(data ?? []);
      if (!parsed.success) return [];
      return parsed.data.map((row) => ({ ...row, bucket: String(row.bucket) }));
    },
    enabled: Boolean(start && end && isDateRangeValid(start, end)),
  });
}

export function useAdminUsageTenants(start: string, end: string) {
  return useQuery<UsageTenantRow[]>({
    queryKey: [...ADMIN_USAGE_TENANTS_KEY, start, end],
    queryFn: async () => {
      const pStart = toTimestamp(start);
      const pEnd = toTimestamp(end, true);
      if (!pStart || !pEnd || !isDateRangeValid(start, end)) return [];
      const { data, error } = await supabase.rpc("admin_usage_tenants", {
        p_start: pStart,
        p_end: pEnd,
      });
      if (error) throw error;
      const parsed = tenantResponseSchema.safeParse(data ?? []);
      if (!parsed.success) return [];
      return parsed.data;
    },
    enabled: Boolean(start && end && isDateRangeValid(start, end)),
  });
}

/** KPIs derivados do overview (normaliza null). Exportado para testes. */
export function computeUsageKpis(overview: UsageOverview | null) {
  return {
    totalAppointments: overview?.total_appointments ?? 0,
    noShowRate: overview?.no_show_rate ?? 0,
    confirmationRate: overview?.confirmation_rate ?? 0,
    whatsappUsage: overview?.whatsapp_usage ?? 0,
    newTenants: overview?.new_tenants ?? 0,
    retentionRate: overview?.retention?.rate ?? 0,
    retentionActive: overview?.retention?.active ?? 0,
    retentionCancelled: overview?.retention?.cancelled ?? 0,
  };
}

export type UsageTenantStatusFilter = SubscriptionStatus | "todos";

export interface UsageTenantFilters {
  status: UsageTenantStatusFilter;
  plan: PlanSlug | "todos";
}

function isPlanValue(value: unknown): value is PlanSlug | "todos" {
  return value === "todos" || PLAN_SLUGS.includes(value as PlanSlug);
}

function isStatusValue(value: unknown): value is UsageTenantStatusFilter {
  return value === "todos" || SUBSCRIPTION_STATUSES.includes(value as SubscriptionStatus);
}

/** Núcleo: filtra linhas de uso por status e/ou plano, cruzando com tenants (client-side). */
export function filterUsageTenants(
  rows: UsageTenantRow[],
  tenants: TenantListItem[],
  statusOrFilters: UsageTenantStatusFilter | UsageTenantFilters = "todos",
  plan: PlanSlug | "todos" = "todos",
): UsageTenantRow[] {
  let status: UsageTenantStatusFilter = "todos";
  let planFilter: PlanSlug | "todos" = "todos";

  if (typeof statusOrFilters === "string") {
    if (isStatusValue(statusOrFilters) && !isPlanValue(statusOrFilters)) {
      status = statusOrFilters;
    } else if (isPlanValue(statusOrFilters) && !isStatusValue(statusOrFilters)) {
      planFilter = statusOrFilters;
    } else {
      // "todos" é ambíguo: mantém compatibilidade tratando como plano
      planFilter = statusOrFilters as PlanSlug | "todos";
    }
  } else if (statusOrFilters && typeof statusOrFilters === "object") {
    if ("status" in statusOrFilters) status = statusOrFilters.status;
    if ("plan" in statusOrFilters) planFilter = statusOrFilters.plan;
  }

  if (typeof plan === "string" && plan !== "todos") {
    if (isPlanValue(plan) && !isStatusValue(plan)) planFilter = plan;
    else if (isStatusValue(plan) && !isPlanValue(plan)) status = plan;
  }

  let allowedIds: Set<string> | null = null;
  if (status !== "todos" || planFilter !== "todos") {
    allowedIds = new Set(
      tenants
        .filter((t) => {
          const statusMatch = status === "todos" || t.subscription_status === status;
          const planMatch = planFilter === "todos" || t.plan === planFilter;
          return statusMatch && planMatch;
        })
        .map((t) => t.id),
    );
  }

  if (!allowedIds) return rows;
  return rows.filter((r) => allowedIds!.has(r.tenant_id));
}

/** Filtra linhas de uso por status de assinatura. Exportado para testes. */
export function filterUsageTenantsByStatus(
  rows: UsageTenantRow[],
  tenants: TenantListItem[],
  status: UsageTenantStatusFilter,
): UsageTenantRow[] {
  return filterUsageTenants(rows, tenants, status, "todos");
}

/** Filtra linhas de uso por status e plano (AND). Exportado para testes. */
export function filterUsageTenantsByStatusAndPlan(
  rows: UsageTenantRow[],
  tenants: TenantListItem[],
  status: UsageTenantStatusFilter,
  plan: PlanSlug | "todos",
): UsageTenantRow[] {
  return filterUsageTenants(rows, tenants, { status, plan });
}

/** Filtra linhas de uso por plano (compatibilidade). Aceita status opcional. */
/** Alias: plano + status. */
export function filterUsageTenantsByPlanAndStatus(
  rows: UsageTenantRow[],
  tenants: TenantListItem[],
  plan: PlanSlug | "todos",
  status: UsageTenantStatusFilter,
): UsageTenantRow[] {
  return filterUsageTenants(rows, tenants, { status, plan });
}

export function filterUsageTenantsByPlan(
  rows: UsageTenantRow[],
  tenants: TenantListItem[],
  planOrFilters: PlanSlug | "todos" | UsageTenantFilters = "todos",
  statusOrPlan?: UsageTenantStatusFilter | (PlanSlug | "todos"),
): UsageTenantRow[] {
  if (typeof planOrFilters === "object" && planOrFilters !== null) {
    return filterUsageTenants(rows, tenants, planOrFilters);
  }
  // Suporta chamadas (rows, tenants, plan, status) e (rows, tenants, status, plan).
  let plan: PlanSlug | "todos" = "todos";
  let status: UsageTenantStatusFilter = "todos";

  const first = planOrFilters;
  const second = statusOrPlan;

  if (typeof first === "string") {
    if (isPlanValue(first) && !isStatusValue(first)) plan = first;
    else if (isStatusValue(first) && !isPlanValue(first)) status = first;
    else plan = first as PlanSlug | "todos";
  }
  if (typeof second === "string") {
    if (isPlanValue(second) && !isStatusValue(second)) plan = second;
    else if (isStatusValue(second) && !isPlanValue(second)) status = second;
    else {
      // "todos" ambíguo: se plano ainda default, trata como status
      if (plan === "todos" && status === "todos") status = second as UsageTenantStatusFilter;
    }
  }

  return filterUsageTenants(rows, tenants, { status, plan });
}

export { PLAN_SLUGS };
