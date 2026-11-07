import { describe, expect, it } from "vitest";

import { formatCentsToBRL, parseBRLToCents } from "@/lib/money";

/**
 * Dinheiro em centavos inteiros (ADR-005 I9): a borda de apresentação formata
 * via `formatCentsToBRL`; a UI aplica `tabular-nums` nas células de valor.
 * Sem float atravessando a camada de domínio.
 */
describe("formatCentsToBRL", () => {
  it("formata centavos em pt-BR sem float", () => {
    const norm = (s: string) => s.replace(/ /g, " ");
    expect(norm(formatCentsToBRL(11000))).toBe("R$ 110,00");
    expect(norm(formatCentsToBRL(500))).toBe("R$ 5,00");
    expect(norm(formatCentsToBRL(0))).toBe("R$ 0,00");
  });

  it("round-trip com parseBRLToCents preserva o inteiro", () => {
    expect(parseBRLToCents("R$ 110,00")).toBe(11000);
    expect(parseBRLToCents("5,00")).toBe(500);
  });
});
