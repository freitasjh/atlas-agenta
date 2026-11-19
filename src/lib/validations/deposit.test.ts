// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";

import {
  calcDepositCents,
  depositConfigSchema,
} from "@/lib/validations/deposit";

describe("depositConfigSchema — ADR-12 (espelha CHECKs da ADR-02)", () => {
  it("aceita config desabilitada sem exigir tipo/valor", () => {
    const parsed = depositConfigSchema.parse({
      enabled: false,
      type: null,
      value: 0,
      deadlineHours: 24,
      refundPolicy: "none",
      refundPercent: null,
    });
    expect(parsed.enabled).toBe(false);
  });

  it("aceita percentual válido com reembolso parcial", () => {
    const parsed = depositConfigSchema.parse({
      enabled: true,
      type: "percent",
      value: 30,
      deadlineHours: 24,
      refundPolicy: "partial",
      refundPercent: 50,
    });
    expect(parsed.type).toBe("percent");
    expect(parsed.value).toBe(30);
  });

  it("aceita valor fixo com reembolso total", () => {
    const parsed = depositConfigSchema.parse({
      enabled: true,
      type: "fixed",
      value: 5000,
      deadlineHours: 48,
      refundPolicy: "total",
      refundPercent: null,
    });
    expect(parsed.type).toBe("fixed");
  });

  it("rejeita habilitado sem tipo", () => {
    const result = depositConfigSchema.safeParse({
      enabled: true,
      type: null,
      value: 30,
      deadlineHours: 24,
      refundPolicy: "none",
      refundPercent: null,
    });
    expect(result.success).toBe(false);
  });

  it("rejeita percentual fora de 1–100", () => {
    for (const value of [0, 101]) {
      const result = depositConfigSchema.safeParse({
        enabled: true,
        type: "percent",
        value,
        deadlineHours: 24,
        refundPolicy: "none",
        refundPercent: null,
      });
      expect(result.success).toBe(false);
    }
  });

  it("rejeita fixo abaixo de R$ 1,00", () => {
    const result = depositConfigSchema.safeParse({
      enabled: true,
      type: "fixed",
      value: 50,
      deadlineHours: 24,
      refundPolicy: "none",
      refundPercent: null,
    });
    expect(result.success).toBe(false);
  });

  it("rejeita parcial sem percentual de reembolso", () => {
    const result = depositConfigSchema.safeParse({
      enabled: true,
      type: "percent",
      value: 30,
      deadlineHours: 24,
      refundPolicy: "partial",
      refundPercent: null,
    });
    expect(result.success).toBe(false);
  });

  it("rejeita prazo zerado", () => {
    const result = depositConfigSchema.safeParse({
      enabled: true,
      type: "percent",
      value: 30,
      deadlineHours: 0,
      refundPolicy: "none",
      refundPercent: null,
    });
    expect(result.success).toBe(false);
  });
});

describe("calcDepositCents — centavos inteiros, sem float", () => {
  it("percentual calcula sobre o preço", () => {
    expect(calcDepositCents(10000, "percent", 30)).toBe(3000);
  });

  it("fixo retorna o valor direto", () => {
    expect(calcDepositCents(10000, "fixed", 5000)).toBe(5000);
  });

  it("tipo nulo retorna zero", () => {
    expect(calcDepositCents(10000, null, 30)).toBe(0);
  });

  it("arredonda meio centavo sem float", () => {
    expect(calcDepositCents(333, "percent", 33)).toBe(110);
  });
});
