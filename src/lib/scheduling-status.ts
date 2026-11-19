import { getAppointmentStatusLabel } from "@/components/StatusBadge";
import type { AppointmentStatus } from "@/types/domain";

/**
 * Máquina de estados do agendamento na UI — **fonte única** do que o menu
 * "Mudar status" oferece e do que a mutação valida antes de enviar.
 *
 * Espelha 1:1 o trigger do banco (`appointments_validate_transition`, ADR-04 /
 * migration `..._appointments_state_machine.sql`). A UI é defesa de usabilidade
 * (só oferece transições válidas, mensagens pt-BR); a trava real é o trigger.
 *
 *   pendente       -> confirmado | em_atendimento | cancelado | nao_compareceu
 *   aguardando_deposito -> pendente | confirmado | cancelado (Fase 4, ADR-02)
 *   confirmado     -> em_atendimento | cancelado | nao_compareceu
 *   em_atendimento -> concluido | cancelado
 *   concluido      -> (final)
 *   cancelado      -> (final)
 *   nao_compareceu -> (final)
 */
export const ALLOWED_TRANSITIONS: Record<
  AppointmentStatus,
  AppointmentStatus[]
> = {
  pendente: ["confirmado", "em_atendimento", "cancelado", "nao_compareceu"],
  aguardando_deposito: ["pendente", "confirmado", "cancelado"],
  confirmado: ["em_atendimento", "cancelado", "nao_compareceu"],
  em_atendimento: ["concluido", "cancelado"],
  concluido: [],
  cancelado: [],
  nao_compareceu: [],
};

/**
 * Transições que exigem confirmação explícita (consequência relevante), para o
 * `StatusChangeConfirm` (ADR-08). `concluido` dispara (em fase futura) a
 * cobrança; `cancelado`/`nao_compareceu` encerram o agendamento.
 */
export const SENSITIVE_TRANSITIONS: readonly AppointmentStatus[] = [
  "concluido",
  "cancelado",
  "nao_compareceu",
];

/** Destinos válidos a partir do estado atual (vazio em estado final). */
export function getAllowedTransitions(
  status: AppointmentStatus,
): AppointmentStatus[] {
  return ALLOWED_TRANSITIONS[status];
}

/** True quando o estado é final (sem transições — o menu de status some). */
export function isFinalStatus(status: AppointmentStatus): boolean {
  return ALLOWED_TRANSITIONS[status].length === 0;
}

/** True se a transição `from → to` é permitida pela máquina de estados. */
export function isTransitionAllowed(
  from: AppointmentStatus,
  to: AppointmentStatus,
): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

/** Rótulo pt-BR do estado destino, reusando o mapa do `StatusBadge`. */
export function getTransitionLabel(status: AppointmentStatus): string {
  return getAppointmentStatusLabel(status);
}

/**
 * Status que **não** ocupam a agenda do profissional — espelham o
 * `where (status not in ('cancelado','nao_compareceu','concluido'))` da
 * constraint `appointments_no_overlap` (migration
 * `20261113010000_appointments_no_overlap_concluido.sql`, que reescreveu a
 * `20261112090000_appointments_no_overlap_origin.sql` — por sua vez derivada de
 * `20250219092000_appointments_no_overlap.sql` — para tratar `concluido` como
 * status final/histórico). Ponto único para não divergir da fonte da verdade do
 * banco.
 */
export const INACTIVE_APPOINTMENT_STATUSES: readonly AppointmentStatus[] = [
  "cancelado",
  "nao_compareceu",
  "concluido",
];

/**
 * True quando o agendamento está "ativo" e portanto ocupa o horário do
 * profissional (deve descontar slots). `cancelado`/`nao_compareceu`/`concluido`
 * liberam o horário — mesma regra da constraint de não-sobreposição no banco
 * (AC-13).
 */
export function isActiveAppointmentStatus(status: AppointmentStatus): boolean {
  return !INACTIVE_APPOINTMENT_STATUSES.includes(status);
}

/**
 * Status que **não** representam atendimento, logo nunca contam como
 * agendamento no recorte do dia. Diferente de `INACTIVE_APPOINTMENT_STATUSES`
 * (que responde "ocupa o horário"), aqui `concluido` **entra** na contagem: é
 * atendimento realizado, e esconder o histórico do dia esvazia o calendário de
 * meses passados. Só saem `cancelado`/`nao_compareceu`, que nunca representaram
 * atendimento.
 */
export const NON_COUNTED_APPOINTMENT_STATUSES: readonly AppointmentStatus[] = [
  "cancelado",
  "nao_compareceu",
];

/**
 * True quando o agendamento deve contar no badge da grade mensal. Distinto de
 * `isActiveAppointmentStatus`: `concluido` não ocupa slot, mas é atendimento do
 * dia — a contagem do calendário reflete todos os agendamentos, exceto
 * cancelado/não-comparecido.
 */
export function isCountedAppointmentStatus(status: AppointmentStatus): boolean {
  return !NON_COUNTED_APPOINTMENT_STATUSES.includes(status);
}
