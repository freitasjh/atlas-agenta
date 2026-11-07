import { describe, expect, it } from "vitest";

import {
  computeChangeCents,
  computeDraftRemainingCents,
  derivePaymentStatus,
  validateDraft,
} from "@/app/agenda/pagamentos/payment-math";
import type { PaymentLineDraft } from "@/app/agenda/pagamentos/payment-types";

function line(overrides: Partial<PaymentLineDraft> = {}): PaymentLineDraft {
  return {
    key: overrides.key ?? "k",
    method: overrides.method ?? "dinheiro",
    amountCents: overrides.amountCents ?? 0,
    tipCents: overrides.tipCents ?? 0,
    cashReceivedCents: overrides.cashReceivedCents ?? 0,
    cardConfirmed: overrides.cardConfirmed ?? false,
  };
}

describe("computeChangeCents", () => {
  it("10000 com recebido 12000 → 2000 de troco", () => {
    expect(computeChangeCents(12000, 10000)).toBe(2000);
  });

  it("recebido menor que o valor não gera troco negativo", () => {
    expect(computeChangeCents(9000, 10000)).toBe(0);
  });
});

describe("computeDraftRemainingCents", () => {
  it("soma 6000+3000 sobre 10000 deixa 1000", () => {
    expect(
      computeDraftRemainingCents(10000, [
        line({ amountCents: 6000 }),
        line({ key: "k2", amountCents: 3000 }),
      ]),
    ).toBe(1000);
  });

  it("nunca fica negativo", () => {
    expect(computeDraftRemainingCents(10000, [line({ amountCents: 12000 })])).toBe(0);
  });
});

describe("validateDraft", () => {
  it("total 10000 com linhas 6000+3000 → falta 1000 e confirmação parcial", () => {
    const result = validateDraft({
      totalCents: 10000,
      remainingCents: 10000,
      lines: [line({ amountCents: 6000 }), line({ key: "k2", amountCents: 3000 })],
      mode: "close",
    });
    expect(result.draftRemainingCents).toBe(1000);
    expect(result.requiresPartialConfirm).toBe(true);
    expect(result.canSubmit).toBe(true);
  });

  it("soma maior que o saldo marca exceeds e bloqueia", () => {
    const result = validateDraft({
      totalCents: 10000,
      remainingCents: 10000,
      lines: [line({ amountCents: 11000 })],
      mode: "close",
    });
    expect(result.exceeds).toBe(true);
    expect(result.canSubmit).toBe(false);
  });

  it("gorjeta não reduz o saldo do serviço", () => {
    const result = validateDraft({
      totalCents: 10000,
      remainingCents: 10000,
      lines: [line({ amountCents: 6000, tipCents: 500 })],
      mode: "close",
    });
    expect(result.draftCents).toBe(6000);
    expect(result.draftRemainingCents).toBe(4000);
    expect(result.tipCents).toBe(500);
  });

  it("total zero não aceita linha positiva", () => {
    const zero = validateDraft({
      totalCents: 0,
      remainingCents: 0,
      lines: [],
      mode: "close",
    });
    expect(zero.totalZero).toBe(true);
    expect(zero.canSubmit).toBe(false);

    const negative = validateDraft({
      totalCents: 0,
      remainingCents: 0,
      lines: [line({ amountCents: 100 })],
      mode: "close",
    });
    expect(negative.exceeds).toBe(true);
    expect(negative.canSubmit).toBe(false);
  });

  it("dinheiro recebido menor que a linha marca cashShort", () => {
    const result = validateDraft({
      totalCents: 10000,
      remainingCents: 10000,
      lines: [line({ amountCents: 10000, cashReceivedCents: 9000 })],
      mode: "close",
    });
    expect(result.cashShort).toBe(true);
    expect(result.canSubmit).toBe(false);
  });

  it("cartão/PIX maquininha sem confirmar bloqueia", () => {
    expect(
      validateDraft({
        totalCents: 10000,
        remainingCents: 10000,
        lines: [line({ method: "cartao_debito", amountCents: 10000, cardConfirmed: false })],
        mode: "close",
      }).cardNotConfirmed,
    ).toBe(true);

    expect(
      validateDraft({
        totalCents: 10000,
        remainingCents: 10000,
        lines: [line({ method: "cartao_debito", amountCents: 10000, cardConfirmed: true })],
        mode: "close",
      }).canSubmit,
    ).toBe(true);
  });

  it("split 6000+4000 fecha o saldo", () => {
    const result = validateDraft({
      totalCents: 10000,
      remainingCents: 10000,
      lines: [
        line({ amountCents: 6000 }),
        line({ key: "k2", method: "cartao_debito", amountCents: 4000, cardConfirmed: true }),
      ],
      mode: "register",
    });
    expect(result.draftRemainingCents).toBe(0);
    expect(result.requiresPartialConfirm).toBe(false);
    expect(result.canSubmit).toBe(true);
  });
});

describe("derivePaymentStatus (precedência da ADR-002)", () => {
  it("total zero é quitado", () => {
    expect(
      derivePaymentStatus({ totalCents: 0, paidCents: 0, reservedCents: 0 }),
    ).toBe("quitado");
  });

  it("pago cobre o total → quitado", () => {
    expect(
      derivePaymentStatus({ totalCents: 10000, paidCents: 10000, reservedCents: 0 }),
    ).toBe("quitado");
  });

  it("cobrança pendente tem precedência sobre parcial", () => {
    expect(
      derivePaymentStatus({ totalCents: 10000, paidCents: 2000, reservedCents: 8000 }),
    ).toBe("aguardando_pix");
  });

  it("nada pago → sem_pagamento", () => {
    expect(
      derivePaymentStatus({ totalCents: 10000, paidCents: 0, reservedCents: 0 }),
    ).toBe("sem_pagamento");
  });

  it("parte paga → parcial", () => {
    expect(
      derivePaymentStatus({ totalCents: 10000, paidCents: 4000, reservedCents: 0 }),
    ).toBe("parcial");
  });
});
