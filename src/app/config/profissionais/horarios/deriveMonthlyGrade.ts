import { tenantDateTimeToUtc } from "@/lib/datetime";
import { isActiveAppointmentStatus } from "@/lib/scheduling-status";
import type { AppointmentStatus, ScheduleOverride, WorkingHour } from "@/types/domain";

/**
 * Derivação pura do calendário mensal read-only (FE-01): cascata
 * vigência → exceção (override 1/dia) → grade semanal, espelhando a
 * cascata de `generateAvailableSlots` (ADR-05) sem materializar nada.
 * Entradas são o que o RLS já devolveu; datas são `YYYY-MM-DD` de parede
 * no fuso do tenant (sem conversão UTC aqui — a comparação lexical é
 * cronológica).
 */

export type DayGradeStatus =
  | "fora-vigencia"
  | "folga"
  | "atipico"
  | "grade"
  | "livre";

export interface DayWindow {
  startTime: string;
  endTime: string;
  breakStart: string | null;
  breakEnd: string | null;
}

export interface DayGrade {
  /** Dia de calendário `YYYY-MM-DD` no fuso do tenant. */
  date: string;
  /** Weekday 0=domingo … 6=sábado (UTC — o dia já é parede do tenant). */
  weekday: number;
  status: DayGradeStatus;
  /** Janelas resolvidas (vazio quando folga/fora-vigência/livre). */
  windows: DayWindow[];
  /** True quando o dia é anterior a `today` (passado). */
  isPast: boolean;
}

export interface DeriveMonthlyGradeInput {
  /** Mês `YYYY-MM`. */
  month: string;
  workingHours: WorkingHour[];
  overrides: ScheduleOverride[];
  scheduleStartDate: string | null;
  scheduleEndDate: string | null;
  /** "Hoje" `YYYY-MM-DD` no fuso do tenant (para `isPast`); default: hoje UTC. */
  today?: string;
}

function parseMonth(month: string): { year: number; monthIndex: number } {
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  if (!match) return { year: 0, monthIndex: 0 };
  return { year: Number(match[1]), monthIndex: Number(match[2]) - 1 };
}

function daysInMonth(year: number, monthIndex: number): number {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

function toDateStr(year: number, monthIndex: number, day: number): string {
  const mm = String(monthIndex + 1).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  return `${year}-${mm}-${dd}`;
}

function weekdayOf(dateStr: string): number {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

function isWithinValidity(
  day: string,
  start: string | null,
  end: string | null,
): boolean {
  if (start && day < start) return false;
  if (end && day > end) return false;
  return true;
}

/** Normaliza `time` do banco (`HH:MM:SS`) para `HH:MM` de exibição. */
function hm(value: string | null): string | null {
  return value ? value.slice(0, 5) : null;
}

/**
 * Deriva os dias do mês resolvendo vigência → override → grade.
 * Pura e determinística: nenhuma chamada de rede, nenhum `Date.now()`
 * (salvo o default de `today`, injetável nos testes).
 */
export function deriveMonthlyGrade(input: DeriveMonthlyGradeInput): DayGrade[] {
  const { month, workingHours, overrides } = input;
  const { year, monthIndex } = parseMonth(month);
  if (year === 0) return [];

  const today =
    input.today ?? new Date().toISOString().slice(0, 10);
  const count = daysInMonth(year, monthIndex);

  // Índices pré-computados: grade por weekday (união multi-faixa) e
  // override por data (1/dia por invariante unique).
  const byWeekday = new Map<number, DayWindow[]>();
  for (const wh of workingHours) {
    const list = byWeekday.get(wh.weekday) ?? [];
    list.push({
      startTime: hm(wh.start_time) ?? "",
      endTime: hm(wh.end_time) ?? "",
      breakStart: hm(wh.break_start),
      breakEnd: hm(wh.break_end),
    });
    byWeekday.set(wh.weekday, list);
  }
  const overrideByDate = new Map<string, ScheduleOverride>();
  for (const ov of overrides) overrideByDate.set(ov.override_date, ov);

  const days: DayGrade[] = [];
  for (let day = 1; day <= count; day += 1) {
    const date = toDateStr(year, monthIndex, day);
    const weekday = weekdayOf(date);
    const base: DayGrade = {
      date,
      weekday,
      status: "livre",
      windows: [],
      isPast: date < today,
    };

    // 1. Vigência.
    if (
      !isWithinValidity(
        date,
        input.scheduleStartDate,
        input.scheduleEndDate,
      )
    ) {
      days.push({ ...base, status: "fora-vigencia", windows: [] });
      continue;
    }

    // 2. Exceção da data (sobrepõe a grade).
    const override = overrideByDate.get(date);
    if (override) {
      if (override.is_closed) {
        days.push({ ...base, status: "folga", windows: [] });
        continue;
      }
      const start = hm(override.start_time);
      const end = hm(override.end_time);
      if (start && end) {
        days.push({
          ...base,
          status: "atipico",
          windows: [
            {
              startTime: start,
              endTime: end,
              breakStart: hm(override.break_start),
              breakEnd: hm(override.break_end),
            },
          ],
        });
        continue;
      }
      days.push({ ...base, status: "folga", windows: [] });
      continue;
    }

    // 3. Grade semanal (união das faixas do weekday).
    const windows = byWeekday.get(weekday);
    if (!windows || windows.length === 0) {
      days.push({ ...base, status: "livre", windows: [] });
      continue;
    }
    days.push({ ...base, status: "grade", windows: [...windows] });
  }
  return days;
}

/** Rascunho de grade semanal (faixa a persistir / a checar). */
export interface GradeDraft {
  weekday: number;
  start_time: string;
  end_time: string;
  break_start: string | null;
  break_end: string | null;
}

export interface AppointmentLite {
  id: string;
  startsAt: string;
  endsAt: string;
  status: AppointmentStatus;
}

export interface BatchConflict {
  code: "APPOINTMENT_CONFLICT_FUTURE";
  appointmentId: string;
  date: string;
  message: string;
}

const CONFLICT_MESSAGE =
  "A nova grade conflita com um agendamento futuro. Ajuste o horário ou remova o agendamento antes de salvar.";

/**
 * Conflito batch × appointment (SPEC §5.6): para cada appointment ativo
 * futuro, resolve a janela do weekday dele na grade NOVA; se o bloco
 * `[startsAt, endsAt)` cai fora de toda janela (ou cruza break), gera um
 * conflito. Appointment passado e inativo (`cancelado`/`nao_compareceu`)
 * nunca conflitam. `timeZone` = fuso do tenant para mapear o weekday.
 *
 * Cascata por dia (A1): uma exceção (override) no dia do appointment
 * sobrepõe a grade — dia fechado = sem janela (conflita sempre); dia atípico
 * = só a janela da exceção cobre. Sem overrides (tela sem a lista), vale só
 * a grade semanal.
 *
 * Horizonte (60 dias): a tela consulta appointments de hoje → +60 dias; o
 * que está além desse horizonte não é verificado aqui — alinhado à SPEC
 * (checagem de conflito do save cobre o futuro próximo; a grade nova
 * continua valendo, e appointments distantes seguem protegidos pela
 * geração de slots). Documentado para não virar premissa implícita.
 */
export function findBatchConflicts(input: {
  drafts: GradeDraft[];
  appointments: AppointmentLite[];
  nowUtc: Date;
  timeZone: string;
  overrides?: ScheduleOverride[];
}): BatchConflict[] {
  const byWeekday = new Map<number, GradeDraft[]>();
  for (const draft of input.drafts) {
    const list = byWeekday.get(draft.weekday) ?? [];
    list.push(draft);
    byWeekday.set(draft.weekday, list);
  }
  const overrideByDate = new Map<string, ScheduleOverride>();
  for (const override of input.overrides ?? []) {
    overrideByDate.set(override.override_date, override);
  }

  const conflicts: BatchConflict[] = [];
  for (const appt of input.appointments) {
    if (!isActiveAppointmentStatus(appt.status)) continue;
    const start = new Date(appt.startsAt);
    const end = new Date(appt.endsAt);
    if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()))
      continue;
    if (start.getTime() < input.nowUtc.getTime()) continue; // passado preservado

    // Weekday no fuso do tenant: deriva o dia de parede do instante.
    const dayStr = wallDay(start, input.timeZone);
    if (!dayStr) continue;
    if (!isCoveredOnDay(dayStr, start, end, input, byWeekday, overrideByDate)) {
      conflicts.push({
        code: "APPOINTMENT_CONFLICT_FUTURE",
        appointmentId: appt.id,
        date: dayStr,
        message: CONFLICT_MESSAGE,
      });
    }
  }
  return conflicts;
}

/** True quando `[start, end)` cabe na janela resolvida do dia (exceção → grade). */
function isCoveredOnDay(
  dayStr: string,
  start: Date,
  end: Date,
  input: { timeZone: string },
  byWeekday: Map<number, GradeDraft[]>,
  overrideByDate: Map<string, ScheduleOverride>,
): boolean {
  const override = overrideByDate.get(dayStr);
  if (override) {
    if (override.is_closed) return false;
    const startTime = hm(override.start_time);
    const endTime = hm(override.end_time);
    if (!startTime || !endTime) return false;
    return isCoveredByWindows(
      [
        {
          weekday: weekdayOf(dayStr),
          start_time: startTime,
          end_time: endTime,
          break_start: hm(override.break_start),
          break_end: hm(override.break_end),
        },
      ],
      dayStr,
      start,
      end,
      input.timeZone,
    );
  }
  const windows = byWeekday.get(weekdayOf(dayStr)) ?? [];
  return isCoveredByWindows(windows, dayStr, start, end, input.timeZone);
}

/** Dia de parede (`YYYY-MM-DD` no fuso) correspondente a um instante UTC. */
function wallDay(instant: Date, timeZone: string): string | null {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(instant);
    const get = (type: string) =>
      parts.find((p) => p.type === type)?.value ?? "";
    const y = get("year");
    const m = get("month");
    const d = get("day");
    if (!y || !m || !d) return null;
    return `${y}-${m}-${d}`;
  } catch {
    return null;
  }
}

/** True quando `[start, end)` cabe inteira numa janela, fora do break. */
function isCoveredByWindows(
  windows: GradeDraft[],
  day: string,
  start: Date,
  end: Date,
  timeZone: string,
): boolean {
  for (const win of windows) {
    const winStart = tenantDateTimeToUtc(day, win.start_time.slice(0, 5), timeZone);
    const winEnd = tenantDateTimeToUtc(day, win.end_time.slice(0, 5), timeZone);
    if (!winStart || !winEnd) continue;
    if (start.getTime() < winStart.getTime() || end.getTime() > winEnd.getTime())
      continue;
    if (win.break_start && win.break_end) {
      const breakStart = tenantDateTimeToUtc(
        day,
        win.break_start.slice(0, 5),
        timeZone,
      );
      const breakEnd = tenantDateTimeToUtc(
        day,
        win.break_end.slice(0, 5),
        timeZone,
      );
      if (
        breakStart &&
        breakEnd &&
        start.getTime() < breakEnd.getTime() &&
        breakStart.getTime() < end.getTime()
      ) {
        continue; // cruza o break — tenta a próxima janela
      }
    }
    return true;
  }
  return false;
}

export interface OverrideConflict {
  appointmentId: string;
  message: string;
}

const OVERRIDE_CONFLICT_MESSAGE =
  "Este dia tem um agendamento ativo que ficaria fora do novo horário. O agendamento foi preservado — ajuste o horário ou remova o agendamento antes.";

/**
 * Conflito exceção × appointment (SPEC §5.6 / FE-04): folga (`isClosed`)
 * bloqueia se houver QUALQUER appointment ativo no dia (passado ou futuro —
 * nunca apaga/move agendamento); janela atípica bloqueia se algum appointment
 * ativo cair fora da janela (ou cruzar o break). `cancelado`/`nao_compareceu`
 * liberam o horário.
 */
export function findOverrideConflict(input: {
  overrideDate: string;
  isClosed: boolean;
  startTime?: string;
  endTime?: string;
  breakStart?: string | null;
  breakEnd?: string | null;
  appointments: AppointmentLite[];
  timeZone: string;
}): OverrideConflict | null {
  const active = input.appointments.filter((a) =>
    isActiveAppointmentStatus(a.status),
  );
  if (active.length === 0) return null;

  const draft: GradeDraft | null =
    !input.isClosed && input.startTime && input.endTime
      ? {
          weekday: weekdayOf(input.overrideDate),
          start_time: input.startTime,
          end_time: input.endTime,
          break_start: input.breakStart ?? null,
          break_end: input.breakEnd ?? null,
        }
      : null;

  for (const appt of active) {
    const start = new Date(appt.startsAt);
    const end = new Date(appt.endsAt);
    if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()))
      continue;
    if (input.isClosed) {
      return { appointmentId: appt.id, message: OVERRIDE_CONFLICT_MESSAGE };
    }
    if (!draft) continue;
    if (
      !isCoveredByWindows(
        [draft],
        input.overrideDate,
        start,
        end,
        input.timeZone,
      )
    ) {
      return { appointmentId: appt.id, message: OVERRIDE_CONFLICT_MESSAGE };
    }
  }
  return null;
}

/**
 * Edição retroativa bloqueada (SPEC §5.5): vigência nova com início no
 * passado não pode ser salva (preserva agendamentos passados). Sem início
 * (null) = abertura, nunca bloqueia.
 */
export function isRetroactiveEditBlocked(input: {
  scheduleStartDate: string | null;
  today?: string;
}): boolean {
  const { scheduleStartDate } = input;
  if (!scheduleStartDate) return false;
  const today = input.today ?? new Date().toISOString().slice(0, 10);
  return scheduleStartDate < today;
}
