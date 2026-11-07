import { PAYMENT_ERROR_MAP } from "@/lib/payment-errors";
import type { PaymentsMessages } from "@/app/agenda/pagamentos/payments-messages";

/**
 * Resolve a mensagem pt-BR de um código de erro **sem** o componente comparar
 * texto: o mapa code→chave é a fonte. Código fora do mapa → genérico.
 */
export function paymentErrorMessage(
  messages: PaymentsMessages,
  code: string | null | undefined,
): string {
  if (!code) return messages.error.generic;
  const key = PAYMENT_ERROR_MAP[code]?.messageKey ?? "payments.error.generic";
  const suffix = key.split(".").pop() ?? "generic";
  const group = messages.error as Record<string, string>;
  return group[suffix] ?? messages.error.generic;
}
