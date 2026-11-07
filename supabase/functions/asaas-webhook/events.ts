// Classificação pura dos eventos do Asaas. Nenhum `if` de evento vive no handler.
export type AsaasEventClass = "settle" | "overdue" | "deleted" | "refund" | "ignore";

/**
 * `REFUND`/`CHARGEBACK` vencem qualquer prefixo `PAYMENT_`: um estorno jamais pode
 * ser classificado como liquidação.
 */
export function classifyAsaasEvent(event: string): AsaasEventClass {
  const normalized = (event ?? "").trim().toUpperCase();
  if (normalized.includes("REFUND") || normalized.includes("CHARGEBACK")) return "refund";
  switch (normalized) {
    case "PAYMENT_RECEIVED":
    case "PAYMENT_CONFIRMED":
      return "settle";
    case "PAYMENT_OVERDUE":
      return "overdue";
    case "PAYMENT_DELETED":
      return "deleted";
    default:
      return "ignore";
  }
}
