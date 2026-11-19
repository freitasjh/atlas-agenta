import { computeDaySummary } from "@/app/agenda/model/daySummary";
import type { DaySummaryInput } from "@/app/agenda/model/daySummary";
import { toTenantLocal } from "@/lib/datetime";
import type { AppointmentWithRelations, WorkingHour } from "@/types/domain";

/**
 * Capacidade e ocupação por dia da visão semana (ADR-05).
 *
 * Camada pura: opera sobre a lista dos 7 dias já buscada (nenhuma request
 * nova, RLS intacto). A % por dia reusa `computeDaySummary` (ADR-01), então é
 * consistente com o ResumoDoDia para o mesmo fixture.
 *
 * Capacidade (denominador): soma, por profissional visível, as faixas da
 * `working_hours` do weekday em slots de 30min (descontando o intervalo).
 * Sem grade para o dia/profissional, cai no estimado (slots 08–18) e marca
 * `estimated: true` — resolve o follow-up da ADR-02 sem inventar precisão.
 */

/** Passo da grade em minutos (mesmo do Dia, ADR-03). */
export const WEEK_SLOT_MINUTES = 30;
/** Janela padrão quando não há grade (08h–18h). */
export const WEEK_DEFAULT_START_HOUR = 8;
export const WEEK_DEFAULT_END_HOUR = 18;
/** Slots estimados por profissional sem grade: 10h × 2. */
export const WEEK_DEFAULT_SLOTS_PER_PROFESSIONAL =
  ((WEEK_DEFAULT_END_HOUR - WEEK_DEFAULT_START_HOUR) * 60) / WEEK_SLOT_MINUTES;

export interface WeekCapacity {
  capacity: number;
  /** `true` quando algum profissional usou o denominador estimado. */
  estimated: boolean;
}

/** `HH:MM` (ou prefixo de `HH:MM:SS`) → minutos; `null` se inválido. */
function hhmmToMinutes(time: string | null): number | null {
  if (!time) return null;
  const match = /^(\d{2}):(\d{2})/.exec(time);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

/** Slots de 30min de uma faixa, descontando o intervalo sobreposto. */
function slotsOfWindow(
  start: number,
  end: number,
  breakStart: number | null,
  breakEnd: number | null,
): number {
  let minutes = end - start;
  if (breakStart != null && breakEnd != null && breakEnd > breakStart) {
    const overlap =
      Math.min(end, breakEnd) - Math.max(start, breakStart);
    if (overlap > 0) minutes -= overlap;
  }
  return Math.max(0, Math.floor(minutes / WEEK_SLOT_MINUTES));
}

/**
 * Capacidade do dia: soma por profissional visível. Profissional sem faixa
 * válida no weekday (ou grade ausente) contribui com o estimado 08–18 e
 * marca o dia como `estimated`.
 */
export function capacityForDay(args: {
  workingHours: WorkingHour[];
  weekday: number;
  professionalIds: string[];
}): WeekCapacity {
  const ids =
    args.professionalIds.length > 0 ? args.professionalIds : ["__unknown__"];
  let capacity = 0;
  let estimated = false;
  for (const professionalId of ids) {
    const rows = args.workingHours.filter(
      (wh) =>
        wh.professional_id === professionalId && wh.weekday === args.weekday,
    );
    let slots = 0;
    let hasGrade = false;
    for (const row of rows) {
      const start = hhmmToMinutes(row.start_time);
      const end = hhmmToMinutes(row.end_time);
      if (start == null || end == null || end <= start) continue;
      hasGrade = true;
      slots += slotsOfWindow(
        start,
        end,
        hhmmToMinutes(row.break_start),
        hhmmToMinutes(row.break_end),
      );
    }
    if (!hasGrade) {
      slots = WEEK_DEFAULT_SLOTS_PER_PROFESSIONAL;
      estimated = true;
    }
    capacity += slots;
  }
  return { capacity, estimated };
}

/** Entrada mínima: o que o resumo lê + `starts_at` para agrupar por dia. */
export type WeekOccupancyInput = DaySummaryInput & {
  starts_at: string;
  ends_at: string;
};

export interface WeekDayOccupancySummary {
  day: string;
  weekday: number;
  occupied: number;
  capacity: number;
  estimated: boolean;
  ocupacaoPct: number;
}

/** `YYYY-MM-DD` do `starts_at` no fuso do tenant. */
function tenantDayKey(utcIso: string, timeZone: string): string {
  const { year, month, day } = toTenantLocal(utcIso, timeZone);
  const mm = String(month).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  return `${year}-${mm}-${dd}`;
}

/** Weekday (0=domingo) de um `YYYY-MM-DD`, independente de fuso. */
function weekdayOfDay(day: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!match) return -1;
  return new Date(
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])),
  ).getUTCDay();
}

/**
 * Um resumo por dia da semana, na ordem de `weekDays`. Dias sem agendamento
 * zeram (`0%`) sem quebrar; cancelados não ocupam (regra da ADR-01).
 */
export function summarizeWeekDays(args: {
  appointments: WeekOccupancyInput[];
  weekDays: string[];
  timeZone: string;
  workingHours: WorkingHour[];
  professionalIds: string[];
}): WeekDayOccupancySummary[] {
  // Compatível com a linha cheia (`AppointmentWithRelations` passa direto).
  const laneOf = new Map<string, WeekOccupancyInput[]>();
  for (const appointment of args.appointments as AppointmentWithRelations[]) {
    const key = tenantDayKey(appointment.starts_at, args.timeZone);
    const lane = laneOf.get(key);
    if (lane) lane.push(appointment as WeekOccupancyInput);
    else laneOf.set(key, [appointment as WeekOccupancyInput]);
  }
  return args.weekDays.map((day) => {
    const lane = laneOf.get(day) ?? [];
    // Profissionais da lane completam a lista quando o pai não informou
    // (ex.: filtro já recortou a request); sem ninguém, 1 estimado.
    const ids =
      args.professionalIds.length > 0
        ? args.professionalIds
        : [...new Set(lane.map((a) => a.professional_id))];
    const weekday = weekdayOfDay(day);
    const { capacity, estimated } = capacityForDay({
      workingHours: args.workingHours,
      weekday,
      professionalIds: ids,
    });
    const summary = computeDaySummary(lane, capacity);
    return {
      day,
      weekday,
      occupied: summary.horariosOcupados,
      capacity: summary.capacidade ?? capacity,
      estimated,
      ocupacaoPct: summary.ocupacaoPct ?? 0,
    };
  });
}
