import { describe, expect, it } from "vitest";

import {
  mergeCatalogWithFallback,
  PLAN_SLUGS,
  type Plan,
  type PlanCatalogRow,
  formatPlanPrice,
  getPlan,
  parsePlanSlug,
} from "@/lib/plans";

/**
 * Regressão do catálogo apresentacional (T1.0b): trava os valores de
 * marketing, o formato BRL curto exato e o contrato de validação de `?plano`.
 * Ambiente de teste é `node`, sem DOM — provamos o módulo puro de `src/lib`.
 *
 * `Intl` pt-BR produz um espaço **não quebrável** (U+00A0) entre o símbolo e o
 * número; por isso o esperado é montado a partir do mesmo `Intl`, afirmando a
 * saída real do runtime, não um espaço ASCII presumido.
 */

const BRL_WHOLE = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  maximumFractionDigits: 0,
});

describe("plans — preço (T1.0b)", () => {
  it("price_cents é inteiro travado por plano", () => {
    expect(getPlan("free").price_cents).toBe(0);
    expect(getPlan("starter").price_cents).toBe(5900);
    expect(getPlan("premium").price_cents).toBe(14900);
    expect(getPlan("enterprise").price_cents).toBe(25900);
  });

  it("formatPlanPrice retorna BRL sem centavos", () => {
    expect(formatPlanPrice(getPlan("starter"))).toBe(BRL_WHOLE.format(59));
    expect(formatPlanPrice(getPlan("premium"))).toBe(BRL_WHOLE.format(149));
    expect(formatPlanPrice(getPlan("enterprise"))).toBe(BRL_WHOLE.format(259));
    // Trava também o conteúdo numérico, independente do caractere de espaço.
    expect(formatPlanPrice(getPlan("starter"))).toMatch(/^R\$\s?59$/u);
    expect(formatPlanPrice(getPlan("premium"))).toMatch(/^R\$\s?149$/u);
    expect(formatPlanPrice(getPlan("enterprise"))).toMatch(/^R\$\s?259$/u);
    expect(formatPlanPrice(getPlan("free"))).toMatch(/^R\$\s?0$/u);
  });

  it("nunca exibe centavos (sem vírgula/casas decimais)", () => {
    for (const slug of PLAN_SLUGS) {
      expect(formatPlanPrice(getPlan(slug))).not.toMatch(/,/u);
    }
  });

  it("price_cents é number (sem any)", () => {
    for (const slug of PLAN_SLUGS) {
      const plan: Plan = getPlan(slug);
      expect(typeof plan.price_cents).toBe("number");
      expect(Number.isInteger(plan.price_cents)).toBe(true);
    }
  });
});

describe("plans — contrato de validação inalterado (RF03)", () => {
  it("parsePlanSlug mantém o comportamento", () => {
    expect(parsePlanSlug("hacker")).toBeNull();
    expect(parsePlanSlug(null)).toBeNull();
    expect(parsePlanSlug(" PREMIUM ")).toBe("premium");
  });

  it("slugs antigos do ladder anterior são inválidos", () => {
    expect(parsePlanSlug("individual")).toBeNull();
    expect(parsePlanSlug("clinica")).toBeNull();
    expect(parsePlanSlug("pro")).toBeNull();
  });

  it("premium é o único recomendado", () => {
    const recomendados = PLAN_SLUGS.filter((slug) => getPlan(slug).recomendado);
    expect(recomendados).toEqual(["premium"]);
  });

  it("ladder cobre os 4 slugs", () => {
    expect([...PLAN_SLUGS].sort()).toEqual(
      ["enterprise", "free", "premium", "starter"].sort(),
    );
  });
});

function catalogRow(partial: Partial<PlanCatalogRow> & { slug: string }): PlanCatalogRow {
  return {
    name: partial.slug,
    price_cents: 999,
    prof_limit: null,
    appt_limit: null,
    features: [],
    active: true,
    sort_order: 9,
    ...partial,
  };
}

describe("mergeCatalogWithFallback", () => {
  it("null/[] devolve o fallback integral", () => {
    expect(mergeCatalogWithFallback(null).map((p) => p.slug)).toEqual([
      "free",
      "starter",
      "premium",
      "enterprise",
    ]);
    expect(mergeCatalogWithFallback([]).map((p) => p.slug)).toEqual([
      "free",
      "starter",
      "premium",
      "enterprise",
    ]);
  });

  it("preço da RPC sobrescreve o fallback", () => {
    const merged = mergeCatalogWithFallback([
      catalogRow({ slug: "starter", price_cents: 6000 }),
    ]);
    expect(merged.find((p) => p.slug === "starter")?.price_cents).toBe(6000);
    expect(merged.find((p) => p.slug === "premium")?.price_cents).toBe(14900);
  });

  it("slugs desconhecidos da RPC são ignorados", () => {
    const merged = mergeCatalogWithFallback([
      catalogRow({ slug: "diamond", price_cents: 1 }),
    ]);
    expect(merged.map((p) => p.slug)).toEqual([
      "free",
      "starter",
      "premium",
      "enterprise",
    ]);
  });
});
