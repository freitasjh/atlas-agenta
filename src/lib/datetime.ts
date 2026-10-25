/**
 * Helpers de fuso horário do agendamento, **sem** lib externa
 * (`date-fns-tz`/`luxon`) — só `Intl.DateTimeFormat` + composição com `Date`,
 * mantendo o bundle enxuto (RNF01). Decisão registrada no PRD (§7 item 10): se
 * as conversões ficarem frágeis, revisar em fase futura.
 *
 * Contrato: o banco guarda sempre `timestamptz` UTC (ISO string); a UI recebe e
 * exibe no fuso do tenant (`tenants.timezone`, default `America/Sao_Paulo`). A
 * conversão acontece **só na borda** (ao enviar e ao exibir). Funções puras,
 * testáveis isoladamente.
 */

const DATE_TIME_FIELDS = [
  "year",
  "month",
  "day",
  "hour",
  "minute",
  "second",
] as const;

type DateTimeField = (typeof DATE_TIME_FIELDS)[number];

/**
 * Descompõe um instante (UTC absoluto) nos campos de calendário que ele
 * representa **no fuso `timeZone`**, via `Intl.DateTimeFormat`. Base das demais
 * conversões.
 */
function getPartsInTimeZone(
  date: Date,
  timeZone: string,
): Record<DateTimeField, number> {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

  const parts: Partial<Record<DateTimeField, number>> = {};
  for (const part of formatter.formatToParts(date)) {
    if ((DATE_TIME_FIELDS as readonly string[]).includes(part.type)) {
      // `hour` pode vir "24" em alguns ambientes para meia-noite; normaliza.
      const value = Number(part.value);
      parts[part.type as DateTimeField] = value === 24 ? 0 : value;
    }
  }

  return {
    year: parts.year ?? 0,
    month: parts.month ?? 1,
    day: parts.day ?? 1,
    hour: parts.hour ?? 0,
    minute: parts.minute ?? 0,
    second: parts.second ?? 0,
  };
}

/**
 * Offset do fuso `timeZone` (em minutos, UTC − local negativo a oeste) para o
 * instante `date`. Calculado comparando o "relógio de parede" do fuso com o de
 * UTC no mesmo instante — cobre horário de verão porque usa o instante real.
 */
function getTimeZoneOffsetMinutes(date: Date, timeZone: string): number {
  const local = getPartsInTimeZone(date, timeZone);
  const asUtc = Date.UTC(
    local.year,
    local.month - 1,
    local.day,
    local.hour,
    local.minute,
    local.second,
  );
  // asUtc é o "relógio de parede" local reinterpretado como UTC; a diferença
  // para o instante real é o offset do fuso.
  return Math.round((asUtc - date.getTime()) / 60000);
}

/** Campos de calendário de um horário no fuso do tenant. */
export interface TenantLocalParts {
  year: number;
  /** 1–12. */
  month: number;
  /** 1–31. */
  day: number;
  /** 0–23. */
  hour: number;
  /** 0–59. */
  minute: number;
}

/**
 * UTC → componentes de calendário no fuso do tenant. Use para preencher inputs
 * de data/hora a partir de um `starts_at` persistido.
 */
export function toTenantLocal(
  utcIso: string | Date,
  timeZone: string,
): TenantLocalParts {
  const date = typeof utcIso === "string" ? new Date(utcIso) : utcIso;
  const parts = getPartsInTimeZone(date, timeZone);
  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: parts.hour,
    minute: parts.minute,
  };
}

/**
 * Horário de parede no fuso do tenant → instante UTC (`Date`). Interpreta
 * `year/month/day/hour/minute` como horário local do tenant e devolve o
 * instante absoluto correspondente. Use ao enviar `starts_at` para o banco.
 */
export function fromTenantLocal(
  parts: TenantLocalParts,
  timeZone: string,
): Date {
  // Primeira aproximação: trata os campos como se fossem UTC.
  const naiveUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    0,
  );
  // Corrige pelo offset do fuso naquele instante (duas passadas resolvem a
  // borda de transição de horário de verão).
  const offset1 = getTimeZoneOffsetMinutes(new Date(naiveUtc), timeZone);
  const candidate = new Date(naiveUtc - offset1 * 60000);
  const offset2 = getTimeZoneOffsetMinutes(candidate, timeZone);
  if (offset2 === offset1) return candidate;
  return new Date(naiveUtc - offset2 * 60000);
}

/**
 * Converte os campos de um `<input type="date">` (YYYY-MM-DD) + `<input
 * type="time">` (HH:MM) do fuso do tenant para o instante UTC. Retorna `null`
 * se qualquer campo for inválido.
 */
export function tenantDateTimeToUtc(
  dateStr: string,
  timeStr: string,
  timeZone: string,
): Date | null {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  const timeMatch = /^(\d{2}):(\d{2})$/.exec(timeStr);
  if (!dateMatch || !timeMatch) return null;

  return fromTenantLocal(
    {
      year: Number(dateMatch[1]),
      month: Number(dateMatch[2]),
      day: Number(dateMatch[3]),
      hour: Number(timeMatch[1]),
      minute: Number(timeMatch[2]),
    },
    timeZone,
  );
}

/** Formata o horário (`HH:MM`) de um instante UTC no fuso do tenant. */
export function formatTimeInTenantTz(
  utcIso: string | Date,
  timeZone: string,
): string {
  const date = typeof utcIso === "string" ? new Date(utcIso) : utcIso;
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

/** Formata a data (`dd/MM/yyyy`) de um instante UTC no fuso do tenant. */
export function formatDateInTenantTz(
  utcIso: string | Date,
  timeZone: string,
): string {
  const date = typeof utcIso === "string" ? new Date(utcIso) : utcIso;
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
}

/**
 * Faixa `[início, fim)` do dia `YYYY-MM-DD` (no fuso do tenant) como instantes
 * UTC — para filtrar a lista da agenda por dia na query (ADR-06). `endUtc` é o
 * início do dia seguinte (intervalo semiaberto, coerente com o `tstzrange` do
 * banco).
 */
export function tenantDayRangeUtc(
  dateStr: string,
  timeZone: string,
): { startUtc: Date; endUtc: Date } | null {
  const startUtc = tenantDateTimeToUtc(dateStr, "00:00", timeZone);
  if (!startUtc) return null;
  const endUtc = new Date(startUtc.getTime() + 24 * 60 * 60 * 1000);
  return { startUtc, endUtc };
}

/**
 * Soma `minutes` a um instante UTC (ex.: `ends_at = starts_at +
 * service.duration_minutes`). Opera no eixo absoluto — independe de fuso.
 */
export function addMinutes(utc: Date, minutes: number): Date {
  return new Date(utc.getTime() + minutes * 60000);
}

/** Soma `days` a um `YYYY-MM-DD` por aritmética de calendário (sem fuso). */
function shiftIsoDate(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const base = new Date(Date.UTC(y, m - 1, d));
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString().slice(0, 10);
}

/** Weekday (0=domingo) de um `YYYY-MM-DD`, independente de fuso. */
function weekdayOfIso(dateStr: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (!match) return -1;
  return new Date(
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])),
  ).getUTCDay();
}

/**
 * Faixa `[início, fim)` de um intervalo de **datas de calendário** (`YYYY-MM-DD`
 * de `fromDay` até `toDay`, ambos inclusos) no fuso do tenant, como instantes
 * UTC. `endUtc` é o início do dia **seguinte** a `toDay` (intervalo semiaberto,
 * coerente com `tenantDayRangeUtc` e com o `tstzrange` do banco).
 *
 * Deriva as bordas por **data local** (00:00 do primeiro dia, 00:00 do dia após
 * o último), nunca por soma de `N×24h` — assim permanece correto sob horário de
 * verão, igual ao fix da visão Semana. Retorna `null` se qualquer data for
 * inválida.
 */
export function tenantRangeUtc(
  fromDay: string,
  toDay: string,
  timeZone: string,
): { startUtc: Date; endUtc: Date } | null {
  const startUtc = tenantDateTimeToUtc(fromDay, "00:00", timeZone);
  const endUtc = tenantDateTimeToUtc(shiftIsoDate(toDay, 1), "00:00", timeZone);
  if (!startUtc || !endUtc) return null;
  return { startUtc, endUtc };
}

/**
 * Semana (segunda→domingo) que contém `day` (`YYYY-MM-DD`), como `{ monday,
 * sunday }` em `YYYY-MM-DD`. Mesma convenção da agenda (visão Semana): a semana
 * começa na segunda-feira. Operação de calendário pura (sem fuso); combine com
 * `tenantRangeUtc(monday, sunday, tz)` para obter as bordas UTC.
 */
export function weekRangeOf(day: string): { monday: string; sunday: string } {
  const weekday = weekdayOfIso(day);
  // Distância até a segunda-feira anterior (domingo = 6 posições atrás).
  const offsetToMonday = weekday === 0 ? 6 : weekday - 1;
  const monday = shiftIsoDate(day, -offsetToMonday);
  const sunday = shiftIsoDate(monday, 6);
  return { monday, sunday };
}
