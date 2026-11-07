import {
  paymentsMessages,
  type PaymentsMessages,
} from "@/app/agenda/pagamentos/payments-messages";

function build(
  source: Record<string, unknown>,
  path: string[] = [],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(source)) {
    if (typeof value === "string") {
      out[key] = `⟪${[...path, key].join(".")}⟫`;
    } else {
      out[key] = build(value as Record<string, unknown>, [...path, key]);
    }
  }
  return out;
}

/**
 * Catálogo-sonda: cada folha vira `⟪grupo.chave⟫`. Qualquer literal de UI no
 * DOM que não venha do catálogo falha a asserção (prova de RNF-03).
 */
export function makeMessagesSpy(): PaymentsMessages {
  return build(paymentsMessages) as unknown as PaymentsMessages;
}
