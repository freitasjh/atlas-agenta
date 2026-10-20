import {
  addMinutes,
  tenantDateTimeToUtc,
  formatTimeInTenantTz,
} from "@/lib/datetime";
import type { ScheduleOverride, WorkingHour } from "@/types/domain";

/**
 * Gerador de slots de agendamento **puro e sob demanda** (ADR-05 agenda). Sem
 * React e sem acesso a dados: recebe os insumos já lidos sob RLS (grade,
 * exceção, vigência, ocupados) e devolve os horários de início livres para
 * `(profissional, serviço, dia)`. Nada é materializado no banco (AC-21).
 *
 * Toda a aritmética de janela é feita no **fuso do tenant** convertendo cada
 * horário de parede (`HH:MM`) do dia em instante UTC via `datetime.ts` (que
 * trata horário de verão pelo instante real), e a comparação de ocupação /
 * passado é feita em UTC. Função determinística — `nowUtc` é injetável para
 * teste.
 *
 * Cascata de precedência por dia (data §8 / PRD §3.2):
 *   1. vigência (`scheduleStartDate`/`scheduleEndDate`): fora do intervalo →
 *      sem slots;
 *   2. exceção (`override` da data): `is_closed=true` → sem slots;
 *      `is_closed=false` → usa a janela da exceção, ignorando a grade;
 *   3. grade semanal (`workingHours` do weekday): só sem exceção e dentro da
 *      vigência; múltiplas faixas no mesmo weekday viram a união das janelas.
 *
 * A não-sobreposição real continua sendo do banco (constraint
 * `appointments_no_overlap`); os slots aqui são oferta otimista.
 */

/** Um horário de início ofertável, já em UTC + rótulo no fuso do tenant. */
export interface AvailableSlot {
  /** Instante UTC do início (ISO string). */
  startUtc: string;
  /** Instante UTC do fim (`startUtc + durationMinutes`, ISO string). */
  endUtc: string;
  /** Rótulo `HH:MM` do início no fuso do tenant (para exibição). */
  label: string;
}

/** Faixa de ocupação ativa (agendamento) a descontar. */
export interface BusyInterval {
  startsAt: string;
  endsAt: string;
}

export interface GenerateAvailableSlotsInput {
  /** Dia alvo `YYYY-MM-DD` no fuso do tenant. */
  day: string;
  /** Fuso do tenant (ex.: `America/Sao_Paulo`). */
  timeZone: string;
  /** Duração do serviço (`services.duration_minutes`). */
  durationMinutes: number;
  /** Passo-base de oferta (`professionals.slot_step_minutes`). */
  slotStepMinutes: number;
  /** Vigência da grade (dia de calendário `YYYY-MM-DD` ou `null` = sem limite). */
  scheduleStartDate: string | null;
  scheduleEndDate: string | null;
  /** Faixas da grade do weekday do dia (pode ser 0..N). */
  workingHours: WorkingHour[];
  /** Exceção da data, se houver. */
  override: ScheduleOverride | null;
  /** Agendamentos ativos do dia/profissional a descontar. */
  busy: BusyInterval[];
  /** "Agora" injetável para teste; default `new Date()`. */
  nowUtc?: Date;
}

/** Janela de expediente de um dia (horas de parede `HH:MM`, break opcional). */
interface Window {
  startTime: string;
  endTime: string;
  breakStart: string | null;
  breakEnd: string | null;
}

/**
 * Dia de calendário do `override.override_date` / vigência. Comparação lexical
 * de `YYYY-MM-DD` é equivalente à cronológica (datas zero-padded).
 */
function isWithinValidity(
  day: string,
  start: string | null,
  end: string | null,
): boolean {
  if (start && day < start) return false;
  if (end && day > end) return false;
  return true;
}

/**
 * Resolve as janelas do dia seguindo a cascata de precedência. Devolve `null`
 * quando não há atendimento (fora da vigência, exceção fechada, ou sem grade).
 */
function resolveWindows(input: GenerateAvailableSlotsInput): Window[] | null {
  // 1. Vigência.
  if (!isWithinValidity(input.day, input.scheduleStartDate, input.scheduleEndDate)) {
    return null;
  }

  // 2. Exceção da data (sobrepõe a grade).
  if (input.override) {
    if (input.override.is_closed) return null;
    if (!input.override.start_time || !input.override.end_time) return null;
    return [
      {
        startTime: input.override.start_time,
        endTime: input.override.end_time,
        breakStart: input.override.break_start,
        breakEnd: input.override.break_end,
      },
    ];
  }

  // 3. Grade semanal (união das faixas do weekday).
  if (input.workingHours.length === 0) return null;
  return input.workingHours.map((wh) => ({
    startTime: wh.start_time,
    endTime: wh.end_time,
    breakStart: wh.break_start,
    breakEnd: wh.break_end,
  }));
}

/** Converte `HH:MM` do dia (fuso do tenant) em instante UTC; `null` se inválido. */
function windowTimeToUtc(
  day: string,
  time: string,
  timeZone: string,
): Date | null {
  return tenantDateTimeToUtc(day, time.slice(0, 5), timeZone);
}

/** `[aStart, aEnd)` sobrepõe `[bStart, bEnd)` (instantes em ms). */
function overlaps(
  aStart: number,
  aEnd: number,
  bStart: number,
  bEnd: number,
): boolean {
  return aStart < bEnd && bStart < aEnd;
}

/**
 * Gera os horários de início livres para o dia. Varre cada janela de
 * `slotStepMinutes` em `slotStepMinutes`; um início vira slot só se o bloco
 * `[início, início+duração)` **cabe inteiro** na janela (não cruza o fim nem o
 * break), não está no **passado** e não **sobrepõe** um ocupado ativo. O
 * resultado é ordenado e sem duplicatas (faixas sobrepostas da grade não geram
 * inícios repetidos).
 */
export function generateAvailableSlots(
  input: GenerateAvailableSlotsInput,
): AvailableSlot[] {
  const { durationMinutes, slotStepMinutes, timeZone, day } = input;

  if (durationMinutes <= 0 || slotStepMinutes <= 0) return [];

  const windows = resolveWindows(input);
  if (!windows) return [];

  const now = input.nowUtc ?? new Date();
  const nowMs = now.getTime();

  // Pré-calcula os ocupados ativos em ms (instantes UTC).
  const busyMs = input.busy
    .map((b) => ({
      start: new Date(b.startsAt).getTime(),
      end: new Date(b.endsAt).getTime(),
    }))
    .filter((b) => Number.isFinite(b.start) && Number.isFinite(b.end));

  // Mapa por instante de início (ms) para deduplicar faixas sobrepostas.
  const byStart = new Map<number, AvailableSlot>();

  for (const win of windows) {
    const windowStart = windowTimeToUtc(day, win.startTime, timeZone);
    const windowEnd = windowTimeToUtc(day, win.endTime, timeZone);
    if (!windowStart || !windowEnd || windowStart >= windowEnd) continue;

    const breakStart =
      win.breakStart && win.breakEnd
        ? windowTimeToUtc(day, win.breakStart, timeZone)
        : null;
    const breakEnd =
      win.breakStart && win.breakEnd
        ? windowTimeToUtc(day, win.breakEnd, timeZone)
        : null;

    const stepMs = slotStepMinutes * 60000;
    const windowEndMs = windowEnd.getTime();

    for (
      let cursor = windowStart.getTime();
      cursor + durationMinutes * 60000 <= windowEndMs;
      cursor += stepMs
    ) {
      const slotStart = cursor;
      const slotEnd = cursor + durationMinutes * 60000;

      // Passado (relativo a "agora").
      if (slotStart < nowMs) continue;

      // O bloco não pode cruzar o break.
      if (
        breakStart &&
        breakEnd &&
        overlaps(slotStart, slotEnd, breakStart.getTime(), breakEnd.getTime())
      ) {
        continue;
      }

      // Não pode sobrepor ocupado ativo.
      const collides = busyMs.some((b) =>
        overlaps(slotStart, slotEnd, b.start, b.end),
      );
      if (collides) continue;

      if (!byStart.has(slotStart)) {
        const startDate = new Date(slotStart);
        byStart.set(slotStart, {
          startUtc: startDate.toISOString(),
          endUtc: addMinutes(startDate, durationMinutes).toISOString(),
          label: formatTimeInTenantTz(startDate, timeZone),
        });
      }
    }
  }

  return [...byStart.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, slot]) => slot);
}
