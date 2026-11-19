import { describe, expect, it } from "vitest";

import {
  novaAvulsaSchema,
  progressoRecebido,
  recebimentoSchema,
  receivableVencida,
  restoReceivable,
} from "@/lib/receber";

describe("receber — helpers puros (ADR-07)", () => {
  it("restoReceivable nunca fica negativo e tolera valores inválidos", () => {
    expect(restoReceivable(10_000, 4_000)).toBe(6_000);
    expect(restoReceivable(10_000, 10_000)).toBe(0);
    expect(restoReceivable(10_000, 12_000)).toBe(0);
    expect(restoReceivable(Number.NaN, 100)).toBe(0);
  });

  it("progressoRecebido vai de 0 a 100", () => {
    expect(progressoRecebido(10_000, 0)).toBe(0);
    expect(progressoRecebido(10_000, 5_000)).toBe(50);
    expect(progressoRecebido(10_000, 10_000)).toBe(100);
    expect(progressoRecebido(10_000, 15_000)).toBe(100);
    expect(progressoRecebido(0, 100)).toBe(0);
  });

  it("vencida é derivada: só pendente com vencimento no passado", () => {
    const agora = new Date("2026-11-13T12:00:00.000Z");
    expect(
      receivableVencida({ status: "pendente", vencimento_at: "2026-11-10T12:00:00.000Z" }, agora),
    ).toBe(true);
    expect(
      receivableVencida({ status: "pendente", vencimento_at: "2026-11-20T12:00:00.000Z" }, agora),
    ).toBe(false);
    expect(
      receivableVencida({ status: "parcial", vencimento_at: "2026-11-01T12:00:00.000Z" }, agora),
    ).toBe(false);
    expect(
      receivableVencida({ status: "pago", vencimento_at: "2026-11-01T12:00:00.000Z" }, agora),
    ).toBe(false);
  });

  it("nova avulsa exige cliente, descrição, vencimento e valor; categoria default avulsa", () => {
    const ok = novaAvulsaSchema.safeParse({
      customer_id: "11111111-1111-4111-8111-111111111111",
      descricao: "Produto",
      vencimento: "2026-12-10T12:00",
      valorReais: "50,00",
    });
    expect(ok.success).toBe(true);
    if (ok.success) expect(ok.data.categoria).toBe("avulsa");

    expect(novaAvulsaSchema.safeParse({ descricao: "", valorReais: "" }).success).toBe(false);
    expect(
      novaAvulsaSchema.safeParse({
        customer_id: "nao-uuid",
        descricao: "Produto",
        vencimento: "2026-12-10T12:00",
        valorReais: "1",
      }).success,
    ).toBe(false);
  });

  it("recebimento exige valor/data e método do enum", () => {
    expect(
      recebimentoSchema.safeParse({ valorReais: "10,00", recebidoEm: "2026-11-13T10:00" }).success,
    ).toBe(true);
    expect(
      recebimentoSchema.safeParse({
        valorReais: "10,00",
        recebidoEm: "2026-11-13T10:00",
        metodo: "boleto",
      }).success,
    ).toBe(false);
  });
});
