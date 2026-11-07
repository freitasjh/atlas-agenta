import { describe, expect, it } from "vitest";

import {
  PAYMENT_ERROR_MAP,
  PaymentApiError,
  parsePaymentError,
  toPaymentApiError,
} from "@/lib/payment-errors";

describe("PAYMENT_ERROR_MAP", () => {
  it("mapeia os códigos do contrato para chave/retry/ação", () => {
    expect(PAYMENT_ERROR_MAP.AMOUNT_EXCEEDS_REMAINING).toMatchObject({
      messageKey: "payments.error.exceeds",
      retryable: false,
      action: "review",
    });
    expect(PAYMENT_ERROR_MAP.GATEWAY_ERROR).toMatchObject({
      messageKey: "payments.error.gateway",
      retryable: true,
      action: "retry",
    });
    expect(PAYMENT_ERROR_MAP.PIX_ALREADY_PENDING).toMatchObject({
      messageKey: "payments.error.pendingExists",
      retryable: false,
    });
    expect(PAYMENT_ERROR_MAP.IDEMPOTENCY_CONFLICT).toMatchObject({
      messageKey: "payments.error.idempotency",
      action: "review",
    });
    expect(PAYMENT_ERROR_MAP.APPOINTMENT_ALREADY_CONCLUDED).toMatchObject({
      messageKey: "payments.error.generic",
    });
    expect(PAYMENT_ERROR_MAP.FORBIDDEN).toMatchObject({
      messageKey: "payments.error.forbidden",
    });
    expect(PAYMENT_ERROR_MAP.PROFESSIONAL_NOT_OWNER).toMatchObject({
      messageKey: "payments.error.forbidden",
    });
    expect(PAYMENT_ERROR_MAP.CHARGE_NOT_PENDING).toMatchObject({
      messageKey: "payments.error.generic",
    });
    expect(PAYMENT_ERROR_MAP.CHARGE_CANCELLED).toMatchObject({
      messageKey: "payments.error.generic",
    });
    expect(PAYMENT_ERROR_MAP.ASAAS_NOT_CONFIGURED).toMatchObject({
      messageKey: "payments.error.noAsaas",
    });
    expect(PAYMENT_ERROR_MAP.NETWORK).toMatchObject({
      messageKey: "payments.error.network",
      retryable: true,
    });
  });
});

describe("parsePaymentError", () => {
  it("422 GATEWAY_ERROR → retryable e action retry", () => {
    const error = parsePaymentError(
      { status: 422 },
      { code: "GATEWAY_ERROR", settlement: { total_paid_cents: 100 } },
    );
    expect(error).toBeInstanceOf(PaymentApiError);
    expect(error.code).toBe("GATEWAY_ERROR");
    expect(error.status).toBe(422);
    expect(error.retryable).toBe(true);
    expect(error.info.action).toBe("retry");
    expect(error.settlement).not.toBeNull();
  });

  it("código desconhecido cai no genérico", () => {
    const error = parsePaymentError({ status: 500 }, { code: "ALGO_NOVO" });
    expect(error.code).toBe("ALGO_NOVO");
    expect(error.info.messageKey).toBe("payments.error.generic");
  });

  it("corpo ilegível vira NETWORK e nunca lança", () => {
    expect(() => parsePaymentError(undefined)).not.toThrow();
    expect(parsePaymentError(undefined).code).toBe("NETWORK");
    expect(parsePaymentError("boom").code).toBe("NETWORK");
  });

  it("preserva pix_amount_cents do corpo", () => {
    const error = parsePaymentError(
      { status: 422 },
      { code: "GATEWAY_ERROR", pix_amount_cents: 3000 },
    );
    expect(error.pixAmountCents).toBe(3000);
  });

  it("é idempotente quando recebe PaymentApiError", () => {
    const original = new PaymentApiError("FORBIDDEN", { status: 403 });
    expect(parsePaymentError(original)).toBe(original);
  });
});

describe("toPaymentApiError", () => {
  it("lê o Response em context e extrai o código", async () => {
    const response = new Response(JSON.stringify({ code: "GATEWAY_ERROR" }), {
      status: 422,
      headers: { "content-type": "application/json" },
    });
    const error = await toPaymentApiError({ context: response });
    expect(error.code).toBe("GATEWAY_ERROR");
    expect(error.status).toBe(422);
  });

  it("falha de parse do Response vira NETWORK", async () => {
    const response = new Response("not-json", { status: 502 });
    const error = await toPaymentApiError({ context: response });
    expect(error.code).toBe("NETWORK");
  });

  it("erro simples sem context vira NETWORK", async () => {
    const error = await toPaymentApiError(new Error("offline"));
    expect(error.code).toBe("NETWORK");
  });
});
