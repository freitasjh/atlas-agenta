import { describe, expect, it } from "vitest";

import {
  MAX_COMMISSION_BPS,
  bpsToNumericPct,
  formatBpsToPercent,
  numericPctToBps,
  parsePercentToBps,
} from "@/lib/commission";

/**
 * Cobertura dos helpers de comissão (ADR-05, AC-05.2). Peças puras que confinam
 * a conversão percentual↔bps↔numeric na borda — nunca float como fonte de
 * verdade. Ambiente de teste `node`, sem DOM (vitest.config), igual aos demais
 * testes de `src/lib`.
 */

describe("parsePercentToBps", () => {
  it("AC-05.2: converte percentual pt-BR para bps inteiro", () => {
    expect(parsePercentToBps("40")).toBe(4000);
    expect(parsePercentToBps("12,5")).toBe(1250);
    expect(parsePercentToBps("33,33")).toBe(3333);
    expect(parsePercentToBps("0")).toBe(0);
    expect(parsePercentToBps("100")).toBe(MAX_COMMISSION_BPS);
  });

  it("aceita a forma com ponto decimal e o sufixo de percentual", () => {
    expect(parsePercentToBps("12.5")).toBe(1250);
    expect(parsePercentToBps("40%")).toBe(4000);
    expect(parsePercentToBps(" 30 ")).toBe(3000);
  });

  it("AC-05.2: entrada inválida ou vazia devolve null", () => {
    expect(parsePercentToBps("")).toBeNull();
    expect(parsePercentToBps("   ")).toBeNull();
    expect(parsePercentToBps("abc")).toBeNull();
  });

  it("recusa percentual fora de 0–100 (devolve null)", () => {
    expect(parsePercentToBps("101")).toBeNull();
    expect(parsePercentToBps("-5")).toBeNull();
    expect(parsePercentToBps("150,5")).toBeNull();
  });

  it("arredonda half-up para no máximo 2 casas (1 bps = 0,01%)", () => {
    expect(parsePercentToBps("33,335")).toBe(3334);
    expect(parsePercentToBps("12,344")).toBe(1234);
  });
});

describe("formatBpsToPercent", () => {
  it("AC-05.2: formata bps como percentual pt-BR sem sufixo", () => {
    expect(formatBpsToPercent(4000)).toBe("40");
    expect(formatBpsToPercent(1250)).toBe("12,5");
    expect(formatBpsToPercent(3333)).toBe("33,33");
    expect(formatBpsToPercent(0)).toBe("0");
  });

  it("entrada não-finita cai em 0", () => {
    expect(formatBpsToPercent(Number.NaN)).toBe("0");
  });
});

describe("conversão bps ↔ numeric(5,2)", () => {
  it("AC-05.2: bpsToNumericPct produz no máximo 2 casas", () => {
    expect(bpsToNumericPct(4000)).toBe(40);
    expect(bpsToNumericPct(3333)).toBe(33.33);
    expect(bpsToNumericPct(1250)).toBe(12.5);
    expect(bpsToNumericPct(0)).toBe(0);
  });

  it("AC-05.2: numericPctToBps reverte sem ruído de float", () => {
    expect(numericPctToBps(40)).toBe(4000);
    expect(numericPctToBps(33.33)).toBe(3333);
    expect(numericPctToBps(12.5)).toBe(1250);
  });

  it("round-trip bps → numeric → bps é estável", () => {
    for (const bps of [0, 1, 1250, 3333, 4000, MAX_COMMISSION_BPS]) {
      expect(numericPctToBps(bpsToNumericPct(bps))).toBe(bps);
    }
  });
});
