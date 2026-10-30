import { describe, expect, it } from "vitest";

import {
  PLAN_SLUGS,
  type Plan,
  formatPlanPrice,
  getPlan,
  parsePlanSlug,
} from "@/lib/plans";

/**
 * Regressão da fonte única de preço (ADR-01): trava os valores de marketing
 * (RF01/CA01), o formato BRL curto exato (RF02/CA02) e a inalterabilidade do
 * contrato de validação de `?plano` (RF03/CA03). Ambiente de teste é `node`,
 * sem DOM — provamos o módulo puro de `src/lib`.
 *
 * `Intl` pt-BR produz um espaço **não quebrável** (U+00A0) entre o símbolo e o
 * número; por isso o esperado é montado a partir do mesmo `Intl`, afirmando a
 * saída real do runtime, não um espaço ASCII presumido (CA02).
 */

const BRL_WHOLE = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  maximumFractionDigits: 0,
});

describe("plans — preço (ADR-01)", () => {
  it("CA01: price_cents é inteiro travado por plano", () => {
    expect(getPlan("individual").price_cents).toBe(5900);
    expect(getPlan("clinica").price_cents).toBe(14900);
    expect(getPlan("pro").price_cents).toBe(25900);
  });

  it("CA02: formatPlanPrice retorna BRL sem centavos", () => {
    expect(formatPlanPrice(getPlan("individual"))).toBe(BRL_WHOLE.format(59));
    expect(formatPlanPrice(getPlan("clinica"))).toBe(BRL_WHOLE.format(149));
    expect(formatPlanPrice(getPlan("pro"))).toBe(BRL_WHOLE.format(259));
    // Trava também o conteúdo numérico, independente do caractere de espaço.
    expect(formatPlanPrice(getPlan("individual"))).toMatch(/^R\$\s?59$/u);
    expect(formatPlanPrice(getPlan("clinica"))).toMatch(/^R\$\s?149$/u);
    expect(formatPlanPrice(getPlan("pro"))).toMatch(/^R\$\s?259$/u);
  });

  it("CA02: nunca exibe centavos (sem vírgula/casas decimais)", () => {
    for (const slug of PLAN_SLUGS) {
      expect(formatPlanPrice(getPlan(slug))).not.toMatch(/,/u);
    }
  });

  it("CA-fronteira: price_cents é number (sem any)", () => {
    for (const slug of PLAN_SLUGS) {
      const plan: Plan = getPlan(slug);
      expect(typeof plan.price_cents).toBe("number");
      expect(Number.isInteger(plan.price_cents)).toBe(true);
    }
  });
});

describe("plans — contrato de validação inalterado (ADR-01 / RF03)", () => {
  it("CA03: parsePlanSlug mantém o comportamento", () => {
    expect(parsePlanSlug("hacker")).toBeNull();
    expect(parsePlanSlug(null)).toBeNull();
    expect(parsePlanSlug(" CLINICA ")).toBe("clinica");
  });

  it("RF04: clinica é o único recomendado", () => {
    const recomendados = PLAN_SLUGS.filter((slug) => getPlan(slug).recomendado);
    expect(recomendados).toEqual(["clinica"]);
  });
});
