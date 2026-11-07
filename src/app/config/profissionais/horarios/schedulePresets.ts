/**
 * Presets de grade semanal em lote (FE-02) — funções puras sobre os
 * `days` do form (`WorkingHoursDayInput`), sem React nem rede.
 * 1 faixa/dia UI: o preset escreve janela + intervalo opcional por dia.
 */

import type { WeeklyScheduleInput } from "@/lib/validations/catalog";

type Day = WeeklyScheduleInput["days"][number];

export interface SchedulePreset {
  id: string;
  /** Rótulo pt-BR exibido no botão do preset. */
  label: string;
  /** Weekdays (0=domingo) tocados pelo preset. */
  weekdays: number[];
  startTime: string;
  endTime: string;
  hasBreak: boolean;
  breakStart?: string;
  breakEnd?: string;
}

export const SCHEDULE_PRESETS: SchedulePreset[] = [
  {
    id: "seg-sex-08-18",
    label: "Segunda a sexta, 8h às 18h",
    weekdays: [1, 2, 3, 4, 5],
    startTime: "08:00",
    endTime: "18:00",
    hasBreak: false,
  },
  {
    id: "seg-sex-almoco",
    label: "Segunda a sexta, com almoço",
    weekdays: [1, 2, 3, 4, 5],
    startTime: "08:00",
    endTime: "18:00",
    hasBreak: true,
    breakStart: "12:00",
    breakEnd: "13:00",
  },
  {
    id: "ter-sab-08-18",
    label: "Terça a sábado, 8h às 18h",
    weekdays: [2, 3, 4, 5, 6],
    startTime: "08:00",
    endTime: "18:00",
    hasBreak: false,
  },
  {
    id: "fds-sab-09-14",
    label: "Sábado, 9h às 14h",
    weekdays: [6],
    startTime: "09:00",
    endTime: "14:00",
    hasBreak: false,
  },
];

/** Aplica o preset aos dias listados, preservando os demais. */
export function applyPreset(days: Day[], preset: SchedulePreset): Day[] {
  return days.map((day) => {
    if (!preset.weekdays.includes(day.weekday)) return day;
    return {
      ...day,
      enabled: true,
      startTime: preset.startTime,
      endTime: preset.endTime,
      hasBreak: preset.hasBreak,
      breakStart: preset.hasBreak ? preset.breakStart : undefined,
      breakEnd: preset.hasBreak ? preset.breakEnd : undefined,
    };
  });
}

/**
 * Copia a janela (e o intervalo) do dia origem para os dias alvo.
 * Origem desabilitado se propaga como desabilitado (copiar "folga").
 */
export function copyDayToTargets(
  days: Day[],
  sourceWeekday: number,
  targetWeekdays: number[],
): Day[] {
  const source = days.find((d) => d.weekday === sourceWeekday);
  if (!source) return days;
  return days.map((day) => {
    if (!targetWeekdays.includes(day.weekday)) return day;
    return {
      ...day,
      enabled: source.enabled,
      startTime: source.startTime,
      endTime: source.endTime,
      hasBreak: source.enabled ? source.hasBreak : false,
      breakStart: source.enabled ? source.breakStart : undefined,
      breakEnd: source.enabled ? source.breakEnd : undefined,
    };
  });
}

function sameDay(a: Day, b: Day): boolean {
  return (
    a.enabled === b.enabled &&
    (a.startTime ?? "") === (b.startTime ?? "") &&
    (a.endTime ?? "") === (b.endTime ?? "") &&
    a.hasBreak === b.hasBreak &&
    (a.breakStart ?? "") === (b.breakStart ?? "") &&
    (a.breakEnd ?? "") === (b.breakEnd ?? "")
  );
}

/** Quantos dias diferem da grade atual (para o diff sticky "N dias alterados"). */
export function countChangedDays(current: Day[], next: Day[]): number {
  let count = 0;
  for (const day of next) {
    const ref = current.find((c) => c.weekday === day.weekday);
    if (!ref || !sameDay(ref, day)) count += 1;
  }
  return count;
}
