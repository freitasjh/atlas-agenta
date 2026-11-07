import type { PeriodPreset } from "@/app/relatorios/PeriodFilter";

/** `YYYY-MM-DD` de hoje no fuso do tenant. */
export function todayIsoInTenantTz(timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

/** Soma `days` a um `YYYY-MM-DD` por aritmética de calendário (sem fuso). */
export function shiftIsoDate(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const base = new Date(Date.UTC(y, m - 1, d));
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString().slice(0, 10);
}

/** Primeiro e último dia (datas de calendário) do mês que contém `day`. */
export function monthRangeIso(day: string): { first: string; last: string } {
  const [y, m] = day.split("-").map(Number);
  const first = `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-01`;
  const last = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  return { first, last };
}

/** Datas `[start, end]` (inclusivas) de um preset, ancoradas em `today`. */
export function resolvePresetRange(
  preset: Exclude<PeriodPreset, "personalizado">,
  today: string,
): { start: string; end: string } {
  if (preset === "mes") {
    const { first, last } = monthRangeIso(today);
    return { start: first, end: last };
  }
  const prevMonthLast = shiftIsoDate(monthRangeIso(today).first, -1);
  const { first, last } = monthRangeIso(prevMonthLast);
  return { start: first, end: last };
}
