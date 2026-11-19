import type { PeriodPreset } from "@/app/relatorios/PeriodFilter";

/**
 * Aritmética de período dos relatórios de retenção (ADR-17). Mesmo padrão de
 * `ComissoesPage` (datas `YYYY-MM-DD` de calendário, sem fuso; o fuso só entra
 * em `tenantRangeUtc` no hook). `YYYY-MM-DD` de hoje no fuso do tenant.
 */
export function todayIsoInTenantTz(timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function shiftIsoDate(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const base = new Date(Date.UTC(y, m - 1, d));
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString().slice(0, 10);
}

function monthRangeIso(day: string): { first: string; last: string } {
  const [y, m] = day.split("-").map(Number);
  const first = `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-01`;
  const last = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  return { first, last };
}

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

/** `YYYY-MM-DD` → `dd/MM/yyyy` por aritmética de calendário (sem fuso). */
export function formatShortDate(dateStr: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (!match) return dateStr;
  const [, year, month, day] = match;
  return `${day}/${month}/${year}`;
}
