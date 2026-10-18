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
