import { useQuery } from "@tanstack/react-query";
import { z } from "zod";

import { supabase } from "@/lib/supabase";
import { tenantRangeUtc } from "@/lib/datetime";
import { useTenant } from "@/hooks/useTenant";
import { usePermissions } from "@/hooks/usePermissions";

/**
 * Dados dos relatórios de retenção (Fase 4, ADR-09/ADR-17).
 *
 * Chama as RPCs `report_*` (admin only, RLS/role check no banco) via
 * `supabase.rpc(...)`. Nenhum `tenant_id` trafega do cliente; o fuso vive em
 * `datetime.ts` (janela semiaberta `[start, end)`). Retorno é dado externo
 * não confiável: validado por zod antes de usar. Valores monetários em
 * centavos inteiros, taxas como fração 0–1.
 *
 * Contrato real do banco (`20261130090000_retention_reports_rpcs.sql`):
 * - `report_*_rate` retornam UM objeto agregado (não array por grupo); a UI
 *   mostra a linha única "Período". Só `report_utilization.by_professional`
 *   traz breakdown.
 * - `report_retention_summary(p_from, p_to)` compõe os 4 agregados
 *   (noshow/rebooking/utilization/ticket) — sem filtros, sem coorte, sem
 *   WhatsApp. Coorte e WhatsApp têm fontes próprias.
 *
 * Gating: `enabled` só quando `isAdmin` e com fuso resolvido — para
 * não-admin nenhum request de relatório é disparado (a trava real é o RLS).
 */

// ---- Schemas crus das RPCs (nomes reais do banco) ----

const noshowRpcSchema = z.object({
  no_show_rate: z.number().nullable().default(null),
  no_show_count: z.number().int().default(0),
  completed_count: z.number().int().default(0),
  confirmed_count: z.number().int().default(0),
  denominator: z.number().int().default(0),
});

const rebookingRpcSchema = z.object({
  rebooking_rate: z.number().nullable().default(null),
  active_customers: z.number().int().default(0),
  repeat_customers: z.number().int().default(0),
});

const utilizationRpcSchema = z.object({
  utilization_rate: z.number().nullable().default(null),
  occupied_minutes: z.number().int().default(0),
  available_minutes: z.number().int().default(0),
  by_professional: z
    .array(
      z.object({
        professional_id: z.string(),
        occupied_minutes: z.number().int().default(0),
        available_minutes: z.number().int().default(0),
        utilization_rate: z.number().nullable().default(null),
      }),
    )
    .default([]),
});

const ticketRpcSchema = z.object({
  average_ticket_cents: z.number().int().nullable().default(null),
  total_cents: z.number().int().default(0),
  completed_count: z.number().int().default(0),
});

const cohortRpcSchema = z.object({
  cohort_month: z.string(),
  cohort_size: z.number().int().default(0),
  windows: z
    .array(
      z.object({
        window_days: z.number().int(),
        retained_customers: z.number().int().default(0),
        retention_rate: z.number().nullable().default(null),
      }),
    )
    .default([]),
});

const summaryRpcSchema = z.object({
  noshow: noshowRpcSchema,
  rebooking: rebookingRpcSchema,
  utilization: utilizationRpcSchema,
  ticket: ticketRpcSchema,
});

const whatsappKpisSchema = z.object({
  enviadas: z.number().int().default(0),
  respostas: z.number().int().default(0),
});

// ---- Tipos de UI (linhas das tabelas) ----

export interface RetentionSummary {
  rebooking_rate: number | null;
  noshow_rate: number | null;
  utilization_rate: number | null;
  ticket_medio_cents: number | null;
}

const rateRowSchema = z.object({
  key: z.string(),
  label: z.string(),
  rate: z.number().nullable().default(null),
  numerator: z.number().int().default(0),
  denominator: z.number().int().default(0),
});

export type RetentionRateRow = z.infer<typeof rateRowSchema>;

const utilizacaoRowSchema = z.object({
  key: z.string(),
  label: z.string(),
  utilization_rate: z.number().nullable().default(null),
  occupied_minutes: z.number().int().default(0),
  available_minutes: z.number().int().default(0),
});

export type UtilizacaoRow = z.infer<typeof utilizacaoRowSchema>;

const ticketRowSchema = z.object({
  key: z.string(),
  label: z.string(),
  ticket_medio_cents: z.number().int().nullable().default(null),
  total_cents: z.number().int().default(0),
  appointment_count: z.number().int().default(0),
});

export type TicketRow = z.infer<typeof ticketRowSchema>;

const cohortRowSchema = z.object({
  cohort: z.string(),
  cohort_size: z.number().int().default(0),
  retained_count: z.number().int().default(0),
  retention_rate: z.number().nullable().default(null),
});

export type CohortRow = z.infer<typeof cohortRowSchema>;

export interface RetentionFilter {
  startDate: string;
  endDate: string;
  professionalId?: string | null;
  serviceId?: string | null;
}

function toRangeParams(filter: RetentionFilter, timeZone: string) {
  const range = tenantRangeUtc(filter.startDate, filter.endDate, timeZone);
  if (!range) throw new Error("Período inválido.");
  return {
    p_from: range.startUtc.toISOString(),
    p_to: range.endUtc.toISOString(),
  };
}

function toDetailParams(filter: RetentionFilter, timeZone: string) {
  return {
    ...toRangeParams(filter, timeZone),
    p_professional_id: filter.professionalId ? filter.professionalId : null,
    p_service_id: filter.serviceId ? filter.serviceId : null,
  };
}

/** Coorte = mês-calendário do início do período, como data completa `YYYY-MM-01`. */
function toCohortMonth(startDate: string): string {
  const match = /^(\d{4})-(\d{2})-\d{2}$/.exec(startDate);
  if (!match) throw new Error("Período inválido.");
  return `${match[1]}-${match[2]}-01`;
}

function useRetentionGate() {
  const { data: tenant } = useTenant();
  const { isAdmin } = usePermissions();
  return { timeZone: tenant?.timezone, enabled: isAdmin && !!tenant?.timezone };
}

export function useRetentionSummary(filter: RetentionFilter) {
  const { timeZone, enabled } = useRetentionGate();
  return useQuery<RetentionSummary>({
    queryKey: ["retention-summary", filter],
    enabled: enabled && !!filter.startDate && !!filter.endDate,
    queryFn: async () => {
      const params = toRangeParams(filter, timeZone as string);
      const { data, error } = await supabase.rpc(
        "report_retention_summary",
        params,
      );
      if (error) throw error;
      const parsed = summaryRpcSchema.parse(data);
      return {
        rebooking_rate: parsed.rebooking.rebooking_rate,
        noshow_rate: parsed.noshow.no_show_rate,
        utilization_rate: parsed.utilization.utilization_rate,
        ticket_medio_cents: parsed.ticket.average_ticket_cents,
      };
    },
  });
}

export function useRetencaoReport(filter: RetentionFilter) {
  const { timeZone, enabled } = useRetentionGate();
  return useQuery<{ rebooking: RetentionRateRow[]; noshow: RetentionRateRow[]; cohorts: CohortRow[] }>({
    queryKey: ["retention-retencao", filter],
    enabled: enabled && !!filter.startDate && !!filter.endDate,
    queryFn: async () => {
      const params = toDetailParams(filter, timeZone as string);
      const [rebookingRes, noshowRes, cohortRes] = await Promise.all([
        supabase.rpc("report_rebooking_rate", params),
        supabase.rpc("report_noshow_rate", params),
        supabase.rpc("report_cohort_retention", {
          p_cohort_month: toCohortMonth(filter.startDate),
          p_windows: [90],
        }),
      ]);
      if (rebookingRes.error) throw rebookingRes.error;
      if (noshowRes.error) throw noshowRes.error;
      if (cohortRes.error) throw cohortRes.error;
      const rebooking = rebookingRpcSchema.parse(rebookingRes.data);
      const noshow = noshowRpcSchema.parse(noshowRes.data);
      const cohort = cohortRpcSchema.parse(cohortRes.data);
      const window90 = cohort.windows.find((w) => w.window_days === 90) ?? cohort.windows[0];
      return {
        rebooking: [
          {
            key: "total",
            label: "Período",
            rate: rebooking.rebooking_rate,
            numerator: rebooking.repeat_customers,
            denominator: rebooking.active_customers,
          },
        ],
        noshow: [
          {
            key: "total",
            label: "Período",
            rate: noshow.no_show_rate,
            numerator: noshow.no_show_count,
            denominator: noshow.denominator,
          },
        ],
        cohorts: window90
          ? [
              {
                cohort: cohort.cohort_month,
                cohort_size: cohort.cohort_size,
                retained_count: window90.retained_customers,
                retention_rate: window90.retention_rate,
              },
            ]
          : [],
      };
    },
  });
}

export function useUtilizacaoReport(filter: RetentionFilter) {
  const { timeZone, enabled } = useRetentionGate();
  return useQuery<UtilizacaoRow[]>({
    queryKey: ["retention-utilizacao", filter],
    enabled: enabled && !!filter.startDate && !!filter.endDate,
    queryFn: async () => {
      const params = toDetailParams(filter, timeZone as string);
      const { data, error } = await supabase.rpc("report_utilization", params);
      if (error) throw error;
      const parsed = utilizationRpcSchema.parse(data);
      if (parsed.by_professional.length > 0) {
        return parsed.by_professional.map((row) => ({
          key: row.professional_id,
          label: row.professional_id,
          utilization_rate: row.utilization_rate,
          occupied_minutes: row.occupied_minutes,
          available_minutes: row.available_minutes,
        }));
      }
      // Sem grade/profissionais: linha única do agregado para não esconder o total.
      return [
        {
          key: "total",
          label: "Período",
          utilization_rate: parsed.utilization_rate,
          occupied_minutes: parsed.occupied_minutes,
          available_minutes: parsed.available_minutes,
        },
      ];
    },
  });
}

export function useTicketReport(filter: RetentionFilter) {
  const { timeZone, enabled } = useRetentionGate();
  return useQuery<TicketRow[]>({
    queryKey: ["retention-ticket", filter],
    enabled: enabled && !!filter.startDate && !!filter.endDate,
    queryFn: async () => {
      const params = toDetailParams(filter, timeZone as string);
      const { data, error } = await supabase.rpc("report_ticket_medio", params);
      if (error) throw error;
      const parsed = ticketRpcSchema.parse(data);
      return [
        {
          key: "total",
          label: "Período",
          ticket_medio_cents: parsed.average_ticket_cents,
          total_cents: parsed.total_cents,
          appointment_count: parsed.completed_count,
        },
      ];
    },
  });
}

/** Destaque de coorte do mês inicial (janela de 90 dias) — fonte real da RPC de coorte. */
export function useCohortHighlight(filter: RetentionFilter) {
  const { timeZone, enabled } = useRetentionGate();
  return useQuery<{ retention_rate: number | null; cohort_size: number }>({
    queryKey: ["retention-cohort-highlight", filter.startDate],
    enabled: enabled && !!filter.startDate,
    queryFn: async () => {
      void timeZone;
      const { data, error } = await supabase.rpc("report_cohort_retention", {
        p_cohort_month: toCohortMonth(filter.startDate),
        p_windows: [90],
      });
      if (error) throw error;
      const parsed = cohortRpcSchema.parse(data);
      const window90 = parsed.windows.find((w) => w.window_days === 90) ?? parsed.windows[0];
      return {
        retention_rate: window90?.retention_rate ?? null,
        cohort_size: parsed.cohort_size,
      };
    },
  });
}

/**
 * Taxa de resposta do WhatsApp — fonte real `whatsapp_kpis`
 * (respostas ÷ enviadas; `null` sem envios para exibir "—").
 */
export function useWhatsappResponseRate(filter: RetentionFilter) {
  const { timeZone, enabled } = useRetentionGate();
  return useQuery<{ response_rate: number | null }>({
    queryKey: ["retention-whatsapp", filter],
    enabled: enabled && !!filter.startDate && !!filter.endDate,
    queryFn: async () => {
      const params = toRangeParams(filter, timeZone as string);
      const { data, error } = await supabase.rpc("whatsapp_kpis", params);
      if (error) throw error;
      const parsed = whatsappKpisSchema.parse(data);
      if (parsed.enviadas === 0) return { response_rate: null };
      return { response_rate: parsed.respostas / parsed.enviadas };
    },
  });
}

/** Fração 0–1 → "12,5 %" pt-BR; `null` → "—" (nunca NaN/0 % falso). */
export function formatRate(rate: number | null | undefined): string {
  if (rate === null || rate === undefined || !Number.isFinite(rate)) return "—";
  return new Intl.NumberFormat("pt-BR", {
    style: "percent",
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(rate);
}
