import { isActiveAppointmentStatus } from "@/lib/scheduling-status";
import type { AppointmentWithRelations } from "@/types/domain";

/**
 * Sugestão de slot para Duplicar (ADR-03): clona o atendimento no mesmo dia e
 * profissional, a partir do término do original arredondado para a grade de
 * 30min, pulando faixas ocupadas. Puro e testável isoladamente.
 */

export interface DuplicateSlotSuggestion {
  /** `YYYY-MM-DD` (mesmo dia do original — sem DnD inter-dia). */
  date: string;
  /** `HH:MM` no fuso do tenant. */
  time: string;
}

export interface SuggestDuplicateSlotInput {
  appointment: AppointmentWithRelations;
  /** Agendamentos do dia (base para checar ocupação). */
  dayAppointments: AppointmentWithRelations[];
  /** `YYYY-MM-DD` do dia em foco. */
  day: string;
  timeZone: string;
  /** Tamanho do passo da grade em minutos (padrão 30). */
  stepMinutes?: number;
  /** Fim da janela de busca em minutos (padrão 21:00). */
  dayEndMinutes?: number;
}

/** Minutos desde a meia-noite (fuso do tenant) de um instante UTC. */
function minutesOfDay(utcIso: string, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(utcIso));
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  return (hour === 24 ? 0 : hour) * 60 + minute;
}

function minutesToHhmm(minutes: number): string {
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  return `${hour.toString().padStart(2, "0")}:${minute
    .toString()
    .padStart(2, "0")}`;
}

/**
 * Primeiro slot livre de `stepMinutes` com a mesma duração do original, no
 * mesmo dia/profissional. Só agendamentos **ativos** do mesmo profissional
 * bloqueiam (cancelado/não-comparecido/concluído liberam o horário — mesma
 * regra da constraint de não-sobreposição). Retorna `null` se o dia encheu.
 */
export function suggestDuplicateSlot({
  appointment,
  dayAppointments,
  day,
  timeZone,
  stepMinutes = 30,
  dayEndMinutes = 21 * 60,
}: SuggestDuplicateSlotInput): DuplicateSlotSuggestion | null {
  const durationMinutes = Math.max(
    stepMinutes,
    Math.round(
      (new Date(appointment.ends_at).getTime() -
        new Date(appointment.starts_at).getTime()) / 60000,
    ),
  );
  const originalEnd = minutesOfDay(appointment.ends_at, timeZone);
  const searchFrom =
    Math.ceil(originalEnd / stepMinutes) * stepMinutes;

  const busy = dayAppointments
    .filter(
      (other) =>
        other.id !== appointment.id &&
        other.professional_id === appointment.professional_id &&
        isActiveAppointmentStatus(other.status),
    )
    .map((other) => ({
      start: minutesOfDay(other.starts_at, timeZone),
      end: minutesOfDay(other.ends_at, timeZone),
    }));

  for (
    let start = searchFrom;
    start + durationMinutes <= dayEndMinutes;
    start += stepMinutes
  ) {
    const end = start + durationMinutes;
    const overlaps = busy.some((range) => start < range.end && range.start < end);
    if (!overlaps) {
      return { date: day, time: minutesToHhmm(start) };
    }
  }
  return null;
}

export interface DuplicatePrefill {
  professionalId: string;
  time: string;
  customerId?: string;
  serviceId?: string;
  comboId?: string;
}

/**
 * Pré-preenchimento da duplicação para o formulário de criação. Leva só o
 * operacional (cliente/serviço/pacote/profissional/horário sugerido) — nunca
 * `id`, pagamento, comprovante ou comissão (a criação parte do zero).
 */
export function buildDuplicatePrefill(
  appointment: AppointmentWithRelations,
  suggestion: DuplicateSlotSuggestion,
): DuplicatePrefill {
  return {
    professionalId: appointment.professional_id,
    time: suggestion.time,
    customerId: appointment.customer_id ?? undefined,
    serviceId: appointment.service_id ?? undefined,
    comboId: appointment.combo_id ?? undefined,
  };
}

/**
 * Resolve o prefill de Duplicar (ADR-03) a partir da sugestão. Quando o dia
 * está cheio (`suggestion === null`), retorna `time: ""` para o form abrir
 * com o `SlotPicker` no estado "sem-slots" — nunca com o horário de origem
 * (ocupado), que faria o submit bater sempre na checagem local. Mantém
 * cliente/serviço/pacote/profissional para o operador só escolher o horário.
 */
export function resolveDuplicatePrefill(
  appointment: AppointmentWithRelations,
  suggestion: DuplicateSlotSuggestion | null,
): DuplicatePrefill {
  if (!suggestion) {
    return {
      professionalId: appointment.professional_id,
      time: "",
      customerId: appointment.customer_id ?? undefined,
      serviceId: appointment.service_id ?? undefined,
      comboId: appointment.combo_id ?? undefined,
    };
  }
  return buildDuplicatePrefill(appointment, suggestion);
}
