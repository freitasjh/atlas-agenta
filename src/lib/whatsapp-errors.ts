import type { SendOutcome } from "@/lib/whatsapp";

/**
 * Mapa de resultados/erros da Edge Function `whatsapp` → mensagens pt-BR
 * amigáveis. Entrada é **dado não confiável** (resposta de função): lê `outcome`
 * e, no canal de erro do `functions.invoke`, lê `error`/`message` de forma
 * defensiva, nunca vaza schema interno e nunca loga PII do cliente.
 *
 * Dois canais (ADR-04):
 *  - Condições de negócio de `send` vêm no corpo como `{ outcome, ... }`, mesmo
 *    quando o HTTP não é 200. `mapSendOutcome` as traduz pelo `outcome` —
 *    `send_failed` (provedor falhou) é distinto de `not_connected` (instância
 *    desconectada), senão o 502 viraria "conecte o WhatsApp" e esconderia a
 *    falha real.
 *  - Erros de infra/auth (400/401/403/404/500) usam `{ error, issues? }` e caem
 *    no canal de erro do invoke. `mapWhatsAppError` dá o fallback pt-BR.
 */

/** Mensagem pt-BR de cada resultado de negócio do `send`. */
const OUTCOME_MESSAGES: Record<SendOutcome, string> = {
  sent: "Mensagem enviada.",
  // Idempotência: já havia um disparo vivo com a mesma chave — no-op benigno.
  duplicate: "Esta mensagem já havia sido enviada.",
  // Opt-in LGPD ausente: nada foi enviado ao cliente.
  opt_out: "O cliente não autorizou o recebimento de mensagens por WhatsApp.",
  not_connected:
    "O WhatsApp não está conectado. Faça a conexão em Configurações.",
  send_failed: "Não foi possível enviar a mensagem. Tente novamente.",
};

/** True quando o resultado representa sucesso efetivo (sent) ou no-op (duplicate). */
export function isSendSuccess(outcome: SendOutcome): boolean {
  return outcome === "sent" || outcome === "duplicate";
}

/** Mensagem pt-BR para um `outcome` do contrato de `send`. */
export function mapSendOutcome(outcome: SendOutcome): string {
  return OUTCOME_MESSAGES[outcome];
}

const GENERIC_MESSAGE = "Não foi possível concluir a ação. Tente novamente.";
const NO_PERMISSION_MESSAGE = "Sem permissão para esta ação.";
const AUTH_MESSAGE = "Sua sessão expirou. Entre novamente.";

/** Lê `error`/`message` de um erro desconhecido sem assumir o shape. */
function readErrorText(error: unknown): string {
  if (typeof error === "object" && error !== null) {
    if ("error" in error) {
      const value = (error as { error: unknown }).error;
      if (typeof value === "string") return value;
    }
    if ("message" in error) {
      const value = (error as { message: unknown }).message;
      if (typeof value === "string") return value;
    }
  }
  return "";
}

/**
 * Converte um erro de infra/auth do canal de erro do `functions.invoke` em
 * mensagem pt-BR. Fallback seguro quando a condição é desconhecida; não vaza
 * schema nem PII.
 */
export function mapWhatsAppError(error: unknown): string {
  const text = readErrorText(error);

  if (/unauthorized|jwt|token|sess[aã]o/i.test(text)) return AUTH_MESSAGE;
  if (/forbidden|permiss[aã]o|papel|403/i.test(text)) {
    return NO_PERMISSION_MESSAGE;
  }

  return GENERIC_MESSAGE;
}
