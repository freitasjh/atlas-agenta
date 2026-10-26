import { useQuery } from "@tanstack/react-query";
import { z } from "zod";

import { supabase } from "@/lib/supabase";
import { tenantRangeUtc, weekRangeOf } from "@/lib/datetime";
import { useTenant } from "@/hooks/useTenant";

/**
 * Hook de dados do resumo do dashboard operacional (Fatia 1). Primeira chamada
 * `supabase.rpc(...)` do projeto. Orquestra as três RPCs de agregação
 * `SECURITY INVOKER` da ADR-01 numa só `useQuery` (hero + KPIs + tendência):
 *
 *   - `dashboard_agenda_overview`        → no-show/taxas/status/novos clientes
 *                                          (período atual E anterior).
 *   - `dashboard_agenda_por_profissional`→ volume por profissional no período.
 *   - `dashboard_agenda_tendencia_semanal`→ série das últimas N semanas.
 *
 * Fronteiras (herdadas, não reimplementadas aqui):
 *   - Isolamento multi-tenant e RBAC vêm 100% do RLS que as RPCs `SECURITY
 *     INVOKER` herdam (F1/F2). NENHUM `tenant_id` trafega do cliente.
 *   - `professionalId` é conveniência de UI / defesa em profundidade (a trava é
 *     o RLS); para `admin`/recepção é `undefined` → o tenant inteiro.
 *   - O fuso vive só em `datetime.ts`: este hook deriva as bordas em UTC a
 *     partir do `timezone` do tenant e as envia à RPC como instantes absolutos.
 *     A RPC não reimplementa aritmética de fuso (D7).
 *
 * O retorno de cada RPC é dado externo não confiável (mesmo vindo do próprio
 * banco): validado por zod antes de usar (F7), no molde do `appointmentListSchema`.
 */

/** Período operável do painel (bordas sempre no fuso do tenant). */
export type DashboardPeriod = "hoje" | "semana" | "mes";

/** `YYYY-MM-DD` de hoje no fuso do tenant. */
function todayIsoInTenantTz(timeZone: string): string {
  // en-CA já formata como YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

/** Soma `days` a um `YYYY-MM-DD` por aritmética de calendário (sem fuso). */
function shiftIsoDate(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const base = new Date(Date.UTC(y, m - 1, d));
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString().slice(0, 10);
}

/** Primeiro e último dia (datas de calendário) do mês que contém `day`. */
function monthRangeIso(day: string): { first: string; last: string } {
  const [y, m] = day.split("-").map(Number);
  const first = `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-01`;
  // Dia 0 do mês seguinte = último dia do mês atual (sem fuso).
  const lastDate = new Date(Date.UTC(y, m, 0));
  const last = lastDate.toISOString().slice(0, 10);
  return { first, last };
}

/** Bordas de calendário (datas `YYYY-MM-DD`) do período atual e do anterior. */
interface PeriodDays {
  from: string;
  to: string;
  prevFrom: string;
  prevTo: string;
}

/**
 * Resolve o período selecionado em datas de calendário (atual + anterior de
 * mesma duração). "Semana" segue segunda→domingo (`weekRangeOf`), igual à
 * agenda; "mês" é o mês de calendário; "hoje" é o dia local. O período anterior
 * é a janela imediatamente anterior de mesma duração.
 */
function resolvePeriodDays(period: DashboardPeriod, today: string): PeriodDays {
  if (period === "hoje") {
    return {
      from: today,
      to: today,
      prevFrom: shiftIsoDate(today, -1),
      prevTo: shiftIsoDate(today, -1),
    };
  }
  if (period === "semana") {
    const week = weekRangeOf(today);
    if (!week) throw new Error("Semana inválida.");
    const { start, end } = week;
    return {
      from: start,
      to: end,
      prevFrom: shiftIsoDate(start, -7),
      prevTo: shiftIsoDate(end, -7),
    };
  }
  // mês
  const { first, last } = monthRangeIso(today);
  const prevLast = shiftIsoDate(first, -1);
  const { first: prevFirst } = monthRangeIso(prevLast);
  return { from: first, to: last, prevFrom: prevFirst, prevTo: prevLast };
}

/** Quantas semanas a série de tendência cobre (inclui a semana corrente). */
const TREND_WEEKS = 8;

/** Bordas UTC `[start, end)` de cada semana da tendência (mais antiga → atual). */
function trendWeekRanges(
  today: string,
  timeZone: string,
): { starts: string[]; ends: string[] } {
  const currentWeek = weekRangeOf(today);
  if (!currentWeek) throw new Error("Semana inválida.");
  const currentMonday = currentWeek.start;
  const starts: string[] = [];
  const ends: string[] = [];
  for (let i = TREND_WEEKS - 1; i >= 0; i--) {
    const weekMonday = shiftIsoDate(currentMonday, -7 * i);
    const wk = weekRangeOf(weekMonday);
    if (!wk) continue;
    const range = tenantRangeUtc(wk.start, wk.end, timeZone);
    if (!range) continue;
    starts.push(range.startUtc.toISOString());
    ends.push(range.endUtc.toISOString());
  }
  return { starts, ends };
}

/** Contagens dos 6 status da máquina de estados. */
const porStatusSchema = z.object({
  pendente: z.number().int(),
  confirmado: z.number().int(),
  em_atendimento: z.number().int(),
  concluido: z.number().int(),
  cancelado: z.number().int(),
  nao_compareceu: z.number().int(),
});

/** Um bucket (atual ou anterior) do `dashboard_agenda_overview`. */
const overviewBucketSchema = z.object({
  total_agendados: z.number().int(),
  por_status: porStatusSchema,
  nao_compareceu: z.number().int(),
  // Taxas: null quando o denominador é 0 (D5) — a UI exibe "—".
  no_show_rate: z.number().nullable(),
  confirmation_rate: z.number().nullable(),
  attendance_rate: z.number().nullable(),
  new_customers: z.number().int(),
});

const overviewSchema = z.object({
  current: overviewBucketSchema,
  previous: overviewBucketSchema,
});

const perProfessionalSchema = z.array(
  z.object({
    professional_id: z.string(),
    name: z.string(),
    // `count(*)` volta como bigint → o PostgREST serializa como number no JSON.
    total: z.number().int(),
  }),
);

const trendSchema = z.array(
  z.object({
    week_start: z.string(),
    agendados: z.number().int(),
    nao_compareceu: z.number().int(),
  }),
);

export type DashboardOverviewBucket = z.infer<typeof overviewBucketSchema>;
export type DashboardPerProfessional = z.infer<typeof perProfessionalSchema>;
export type DashboardTrend = z.infer<typeof trendSchema>;

/** Shape consolidado que o painel consome. */
export interface DashboardSummary {
  overview: z.infer<typeof overviewSchema>;
  perProfessional: DashboardPerProfessional;
  trend: DashboardTrend;
}

const DASHBOARD_SUMMARY_KEY = ["dashboard-summary"] as const;

export function useDashboardSummary({
  period,
  professionalId,
}: {
  period: DashboardPeriod;
  /** `undefined` = tenant inteiro (admin/recepção); id = só a própria agenda. */
  professionalId?: string;
}) {
  const { data: tenant } = useTenant();
  const timeZone = tenant?.timezone;

  return useQuery<DashboardSummary>({
    queryKey: [...DASHBOARD_SUMMARY_KEY, { period, professionalId }],
    // Precisa do fuso do tenant para derivar as bordas UTC.
    enabled: !!timeZone,
    queryFn: async () => {
      const tz = timeZone as string;
      const today = todayIsoInTenantTz(tz);
      const days = resolvePeriodDays(period, today);

      const current = tenantRangeUtc(days.from, days.to, tz);
      const previous = tenantRangeUtc(days.prevFrom, days.prevTo, tz);
      if (!current || !previous) throw new Error("Período inválido.");

      const trend = trendWeekRanges(today, tz);

      // Três agregações no banco, em paralelo (nenhuma depende da outra).
      const [overviewRes, perProfRes, trendRes] = await Promise.all([
        supabase.rpc("dashboard_agenda_overview", {
          p_start: current.startUtc.toISOString(),
          p_end: current.endUtc.toISOString(),
          p_prev_start: previous.startUtc.toISOString(),
          p_prev_end: previous.endUtc.toISOString(),
          p_professional_id: professionalId ?? null,
        }),
        supabase.rpc("dashboard_agenda_por_profissional", {
          p_start: current.startUtc.toISOString(),
          p_end: current.endUtc.toISOString(),
        }),
        supabase.rpc("dashboard_agenda_tendencia_semanal", {
          p_week_starts: trend.starts,
          p_week_ends: trend.ends,
        }),
      ]);

      if (overviewRes.error) throw overviewRes.error;
      if (perProfRes.error) throw perProfRes.error;
      if (trendRes.error) throw trendRes.error;

      return {
        overview: overviewSchema.parse(overviewRes.data),
        perProfessional: perProfessionalSchema.parse(perProfRes.data),
        trend: trendSchema.parse(trendRes.data),
      };
    },
  });
}
