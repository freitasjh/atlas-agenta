/**
 * Gating de envio automático de confirmação (ADR-07, T2.0 — Fase 1).
 *
 * Fiação pura sobre fluxos existentes, sem motor novo: confirmar 1-clique
 * reaproveita o sender WhatsApp existente **se e somente se**:
 * - `optIn` — `customers.whatsapp_opt_in` (LGPD, R7);
 * - `templateActive` — toggle do template `confirmacao` em
 *   `message_templates` (ausente = não configurado = ligado, mesmo default
 *   da tela de modelos);
 * - `startsAtIso` dentro da janela de 24h a partir de `nowMs` (R8).
 *
 * Fora disso, o chamador só muda o status (silencioso). Nenhuma chamada de
 * rede aqui — só decisão. Pura e determinística para teste direto.
 */

/** Janela de envio automático: 24h (R8). */
export const CONFIRMATION_SEND_WINDOW_MS = 24 * 60 * 60 * 1000;

interface ConfirmationSendInput {
  /** Consentimento LGPD do cliente (`whatsapp_opt_in`). */
  optIn: boolean;
  /** Toggle do template `confirmacao` (ausente = ligado). */
  templateActive: boolean;
  /** Início do atendimento (ISO UTC). */
  startsAtIso: string;
  /** Relógio injetável (testes). Default = agora. */
  nowMs?: number;
}

/**
 * Decide se o confirmar 1-clique dispara a régua existente. Fora da janela
 * ou sem consentimento/toggle → `false` (só muda status, silencioso).
 */
export function shouldAutoSendConfirmation(
  input: ConfirmationSendInput,
): boolean {
  if (!input.optIn || !input.templateActive) return false;
  const startsAtMs = Date.parse(input.startsAtIso);
  if (Number.isNaN(startsAtMs)) return false;
  const nowMs = input.nowMs ?? Date.now();
  return (
    startsAtMs >= nowMs - 60_000 &&
    startsAtMs <= nowMs + CONFIRMATION_SEND_WINDOW_MS
  );
}
