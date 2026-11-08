import { useQuery } from "@tanstack/react-query";
import { z } from "zod";

import { supabase } from "@/lib/supabase";
import { PLAN_SLUGS, type PlanSlug } from "@/lib/plans";

/**
 * Telemetria de planos do super admin (TEL-FE-01) — somente leitura, só RPC.
 *
 * As 4 views (`v_plan_mrr`, `v_trial_conversion_por_plano`, `v_quota_utilization`,
 * `v_churn_por_plano`) são `security_invoker` REVOGADAS para anon/authenticated:
 * o cliente NUNCA as lê direto (nem `.from()`); o único caminho são os 4 RPCs
 * `admin_get_*` (SECURITY DEFINER com guard super_admin interno). Toda resposta
 * é dado não confiável e validada por zod antes do uso.
 */

export const PLAN_TELEMETRY_MRR_KEY = ["admin", "telemetry", "mrr"] as const;
export const PLAN_TELEMETRY_CONVERSION_KEY = ["admin", "telemetry", "conversion"] as const;
export const PLAN_TELEMETRY_QUOTA_KEY = ["admin", "telemetry", "quota"] as const;
export const PLAN_TELEMETRY_CHURN_KEY = ["admin", "telemetry", "churn"] as const;

/** Mês no formato canônico `YYYY-MM` (fuso America/Sao_Paulo na borda). */
const monthSchema = z
  .string()
  .regex(/^[0-9]{4}-(0[1-9]|1[0-2])$/, "mês inválido (esperado YYYY-MM)");

export function isValidTelemetryMonth(value: string): boolean {
  return monthSchema.safeParse(value).success;
}

/** Mês corrente em America/Sao_Paulo (`YYYY-MM`). */
export function currentTelemetryMonth(timeZone = "America/Sao_Paulo"): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
  }).formatToParts(new Date());
  const year = parts.find((p) => p.type === "year")?.value ?? "1970";
  const month = parts.find((p) => p.type === "month")?.value ?? "01";
  return `${year}-${month}`;
}

export type PlanFilter = PlanSlug | "todos";

export function isPlanFilter(value: unknown): value is PlanFilter {
  return value === "todos" || (PLAN_SLUGS as readonly string[]).includes(value as string);
}

// --- MRR --------------------------------------------------------------------

const planMrrEntrySchema = z.object({
  base: z.number().int(),
  mrr_cents: z.number().int(),
});

const planMrrSchema = z
  .object({
    mrr_cents: z.number().int(),
    by_plan: z.record(z.string(), planMrrEntrySchema).default({}),
    base_ativa: z.number().int(),
  })
  .nullable();

export type PlanMrr = Exclude<z.infer<typeof planMrrSchema>, null>;

export function usePlanMrr(month: string) {
  return useQuery<PlanMrr | null>({
    queryKey: [...PLAN_TELEMETRY_MRR_KEY, month],
    queryFn: async () => {
      if (!isValidTelemetryMonth(month)) return null;
      const { data, error } = await supabase.rpc("admin_get_plan_mrr", {
        p_month: month,
      });
      if (error) throw error;
      const parsed = planMrrSchema.safeParse(data);
      if (!parsed.success) return null;
      return parsed.data;
    },
    enabled: isValidTelemetryMonth(month),
  });
}

// --- Conversão trial ---------------------------------------------------------

const trialConversionSchema = z
  .object({
    coorte: z.number().int(),
    convertidos: z.number().int(),
    taxa: z.number().nullable(),
  })
  .nullable();

export type TrialConversion = Exclude<z.infer<typeof trialConversionSchema>, null>;

export interface ConversionFilter {
  start: string;
  end: string;
  plan: PlanFilter;
}

const isoDateSchema = z.string().regex(/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/);

export function useTrialConversion(filter: ConversionFilter) {
  const { start, end, plan } = filter;
  const enabled =
    isoDateSchema.safeParse(start).success &&
    isoDateSchema.safeParse(end).success &&
    start <= end &&
    isPlanFilter(plan);
  return useQuery<TrialConversion | null>({
    queryKey: [...PLAN_TELEMETRY_CONVERSION_KEY, start, end, plan],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_get_trial_conversion", {
        p_start: start,
        p_end: end,
        p_plan: plan === "todos" ? null : plan,
      });
      if (error) throw error;
      const parsed = trialConversionSchema.safeParse(data);
      if (!parsed.success) return null;
      return parsed.data;
    },
    enabled,
  });
}

// --- Quota quente ------------------------------------------------------------

const quotaRowSchema = z.object({
  tenant_id: z.string(),
  trade_name: z.string().nullable(),
  plan: z.string(),
  profs: z.number().int(),
  prof_limit: z.number().int().nullable(),
  appts: z.number().int(),
  appt_limit: z.number().int().nullable(),
  month_key: z.string(),
});

const quotaResponseSchema = z.array(quotaRowSchema);

export type QuotaHotRow = z.infer<typeof quotaRowSchema>;

export function useQuotaUtilization(threshold = 0.8) {
  return useQuery<QuotaHotRow[]>({
    queryKey: [...PLAN_TELEMETRY_QUOTA_KEY, threshold],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_get_quota_utilization", {
        p_threshold: threshold,
      });
      if (error) throw error;
      const parsed = quotaResponseSchema.safeParse(data ?? []);
      if (!parsed.success) return [];
      return parsed.data;
    },
  });
}

/** Maior % de uso da linha (profs ou appts); null quando sem limite nos dois. */
export function quotaRowRatio(row: QuotaHotRow): number | null {
  const ratios: number[] = [];
  if (row.prof_limit !== null && row.prof_limit > 0) {
    ratios.push(row.profs / row.prof_limit);
  }
  if (row.appt_limit !== null && row.appt_limit > 0) {
    ratios.push(row.appts / row.appt_limit);
  }
  if (ratios.length === 0) return null;
  return Math.max(...ratios);
}

/** Ordena quente primeiro (% desc). Exportado para testes. */
export function sortQuotaHot(rows: QuotaHotRow[]): QuotaHotRow[] {
  return [...rows].sort((a, b) => (quotaRowRatio(b) ?? -1) - (quotaRowRatio(a) ?? -1));
}

// --- Churn -------------------------------------------------------------------

const churnEntrySchema = z.object({
  base: z.number().int(),
  churned: z.number().int(),
  taxa: z.number().nullable(),
});

const churnSchema = z
  .object({ by_plan: z.record(z.string(), churnEntrySchema).default({}) })
  .nullable();

export type PlanChurn = Exclude<z.infer<typeof churnSchema>, null>;

export function usePlanChurn(month: string) {
  return useQuery<PlanChurn | null>({
    queryKey: [...PLAN_TELEMETRY_CHURN_KEY, month],
    queryFn: async () => {
      if (!isValidTelemetryMonth(month)) return null;
      const { data, error } = await supabase.rpc("admin_get_churn_por_plano", {
        p_month: month,
      });
      if (error) throw error;
      const parsed = churnSchema.safeParse(data);
      if (!parsed.success) return null;
      return parsed.data;
    },
    enabled: isValidTelemetryMonth(month),
  });
}

// --- Formatação (zero-division: "—", nunca 0%/NaN) -----------------------------

/** Taxa em pt-BR com 1 casa; null/NaN → "—" (apoio decide o texto). */
export function formatRate(taxa: number | null | undefined): string {
  if (taxa === null || taxa === undefined || !Number.isFinite(taxa)) return "—";
  return `${taxa.toFixed(1).replace(".", ",")}%`;
}

/** Moeda pt-BR tabular; null → "—". */
const BRL_FORMATTER = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

export function formatMrrCents(cents: number | null | undefined): string {
  if (cents === null || cents === undefined || !Number.isFinite(cents)) return "—";
  return BRL_FORMATTER.format(cents / 100);
}

export { PLAN_SLUGS };
