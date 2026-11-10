/**
 * Normalização de erros de pagamento (ADR-004 §6.2 / RF-14).
 *
 * Componentes decidem por **código**, nunca por mensagem de texto. O mapa
 * `code → { messageKey, retryable, action }` é a única fonte de decisão.
 */

import type { AppointmentSettlement } from "@/types/payments";

export type PaymentErrorAction = "retry" | "review" | "none";

export interface PaymentErrorInfo {
  messageKey: string;
  retryable: boolean;
  action: PaymentErrorAction;
}

const GENERIC: PaymentErrorInfo = {
  messageKey: "payments.error.generic",
  retryable: false,
  action: "review",
};

export const PAYMENT_ERROR_MAP: Readonly<Record<string, PaymentErrorInfo>> = {
  AMOUNT_EXCEEDS_REMAINING: {
    messageKey: "payments.error.exceeds",
    retryable: false,
    action: "review",
  },
  GATEWAY_ERROR: {
    messageKey: "payments.error.gateway",
    retryable: true,
    action: "retry",
  },
  GATEWAY_CANCEL_FAILED: {
    messageKey: "payments.error.gateway",
    retryable: true,
    action: "retry",
  },
  GATEWAY_IN_PROGRESS: {
    messageKey: "payments.error.gateway",
    retryable: true,
    action: "retry",
  },
  PIX_ALREADY_PENDING: {
    messageKey: "payments.error.pendingExists",
    retryable: false,
    action: "none",
  },
  IDEMPOTENCY_CONFLICT: {
    messageKey: "payments.error.idempotency",
    retryable: false,
    action: "review",
  },
  APPOINTMENT_ALREADY_CONCLUDED: { ...GENERIC },
  APPOINTMENT_INVALID_STATE: { ...GENERIC },
  APPOINTMENT_NOT_FOUND: { ...GENERIC },
  FORBIDDEN: {
    messageKey: "payments.error.forbidden",
    retryable: false,
    action: "none",
  },
  PROFESSIONAL_NOT_OWNER: {
    messageKey: "payments.error.forbidden",
    retryable: false,
    action: "none",
  },
  CHARGE_NOT_PENDING: { ...GENERIC },
  CHARGE_CANCELLED: { ...GENERIC },
  CHARGE_NOT_FOUND: { ...GENERIC },
  ASAAS_NOT_CONFIGURED: {
    messageKey: "payments.error.noAsaas",
    retryable: false,
    action: "none",
  },
  INVALID_AMOUNT: { ...GENERIC },
  INVALID_METHOD: { ...GENERIC },
  INVALID_BODY: { ...GENERIC },
  INTERNAL: {
    messageKey: "payments.error.generic",
    retryable: true,
    action: "retry",
  },
  NETWORK: {
    messageKey: "payments.error.network",
    retryable: true,
    action: "retry",
  },
  SEGMENT_NOT_ENABLED: {
    messageKey: "payments.error.segmentNotEnabled",
    retryable: false,
    action: "none",
  },
  SERVICE_NOT_OFFERED: {
    messageKey: "payments.error.serviceNotOffered",
    retryable: false,
    action: "review",
  },
  PROFESSIONAL_NOT_AVAILABLE: {
    messageKey: "payments.error.professionalBusy",
    retryable: false,
    action: "review",
  },
  SLOT_CONFLICT: {
    messageKey: "payments.error.slotConflict",
    retryable: false,
    action: "review",
  },
};

export interface PaymentApiErrorOptions {
  status?: number;
  settlement?: AppointmentSettlement | null;
  pixAmountCents?: number | null;
}

/** Erro de domínio do pagamento; código estável + metadados para o retry. */
export class PaymentApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly settlement: AppointmentSettlement | null;
  readonly pixAmountCents: number | null;

  constructor(code: string, options: PaymentApiErrorOptions = {}) {
    const info = PAYMENT_ERROR_MAP[code] ?? PAYMENT_ERROR_MAP.NETWORK;
    super(info?.messageKey ?? "payments.error.generic");
    this.name = "PaymentApiError";
    this.code = code;
    this.status = options.status ?? 0;
    this.settlement = options.settlement ?? null;
    this.pixAmountCents = options.pixAmountCents ?? null;
  }

  get info(): PaymentErrorInfo {
    return PAYMENT_ERROR_MAP[this.code] ?? GENERIC;
  }

  get retryable(): boolean {
    return this.info.retryable;
  }
}

function readRecord(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== "object") return null;
  return value as Record<string, unknown>;
}

function readCode(body: Record<string, unknown> | null): string | null {
  if (!body) return null;
  const code = body.code;
  return typeof code === "string" && code.length > 0 ? code : null;
}

/**
 * Converte corpo/erro já lido em `PaymentApiError`. Nunca lança: qualquer
 * entrada ilegível vira `NETWORK`.
 */
export function parsePaymentError(
  error: unknown,
  body?: unknown,
): PaymentApiError {
  if (error instanceof PaymentApiError) return error;

  const record = readRecord(error);
  const bodyRecord = readRecord(body);
  const code =
    readCode(bodyRecord) ??
    (typeof record?.code === "string" ? (record.code as string) : null) ??
    "NETWORK";
  const status =
    typeof record?.status === "number"
      ? (record.status as number)
      : typeof bodyRecord?.status === "number"
        ? (bodyRecord.status as number)
        : 0;

  const settlement =
    (bodyRecord?.settlement as AppointmentSettlement | undefined) ??
    (record?.settlement as AppointmentSettlement | undefined) ??
    null;
  const pixAmount =
    typeof bodyRecord?.pix_amount_cents === "number"
      ? (bodyRecord.pix_amount_cents as number)
      : typeof record?.pix_amount_cents === "number"
        ? (record.pix_amount_cents as number)
        : null;

  return new PaymentApiError(code, {
    status,
    settlement: settlement ?? null,
    pixAmountCents: pixAmount ?? null,
  });
}

/**
 * Lê o corpo JSON de um erro de `functions.invoke` (que carrega um `Response`
 * em `context`) e normaliza. Falha de leitura → `NETWORK`.
 */
export async function toPaymentApiError(
  error: unknown,
): Promise<PaymentApiError> {
  if (error instanceof PaymentApiError) return error;

  const record = readRecord(error);
  const context = record?.context;
  if (context && typeof context === "object" && "clone" in context) {
    try {
      const response = context as Response;
      const body = await response.clone().json();
      return parsePaymentError({ status: response.status }, body);
    } catch {
      return new PaymentApiError("NETWORK", { status: 0 });
    }
  }

  return parsePaymentError(error);
}
