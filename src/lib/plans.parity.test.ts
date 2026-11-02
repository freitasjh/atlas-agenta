import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { PLAN_SLUGS, PLANS, getPlan, type PlanSlug } from "@/lib/plans";
import planPrices from "../../supabase/functions/_shared/plans.json";

/**
 * Guard da fonte única de preço de plano (ADR-13/ADR-20). O frontend
 * (`src/lib/plans.ts`) e a Edge Function `create-subscription-charge`
 * (`supabase/functions/_shared/plans.ts`) precisam ler o **mesmo**
 * `supabase/functions/_shared/plans.json`; se algum lado voltar a hardcodar
 * preço, este teste cai.
 *
 * O JSON vive dentro de `supabase/functions/` porque o bundle de deploy é só
 * essa pasta: um caminho que saia dela quebra `deno check`/`functions deploy`.
 *
 * Mesmo padrão do `suite-command.spec.mjs`: lê os arquivos e falha na
 * divergência, em vez de confiar em comentário.
 */

const ROOT = process.cwd();
const SRC_PLANS = resolve(ROOT, "src/lib/plans.ts");
const DENO_PLANS = resolve(ROOT, "supabase/functions/_shared/plans.ts");
const SUBSCRIPTION_HANDLER = resolve(
  ROOT,
  "supabase/functions/create-subscription-charge/handler.ts",
);
const SUBSCRIPTION_SCHEMAS = resolve(
  ROOT,
  "supabase/functions/create-subscription-charge/schemas.ts",
);

function read(path: string): string {
  return readFileSync(path, "utf8");
}

describe("plans — paridade de preço entre frontend e Edge Function", () => {
  it("os dois lados importam o mesmo supabase/functions/_shared/plans.json", () => {
    expect(read(SRC_PLANS)).toContain(
      'from "../../supabase/functions/_shared/plans.json"',
    );
    expect(read(DENO_PLANS)).toContain('from "./plans.json"');
  });

  it("nenhum lado hardcoda valor de plano", () => {
    const cents = Object.values(planPrices);
    for (const file of [SRC_PLANS, DENO_PLANS, SUBSCRIPTION_HANDLER]) {
      const source = read(file);
      for (const value of cents) {
        expect(source, `${file} contém o literal de preço ${value}`).not.toMatch(
          new RegExp(`\\b${value}\\b`),
        );
      }
    }
  });

  it("o handler não tem tabela de preços própria", () => {
    const source = read(SUBSCRIPTION_HANDLER);
    expect(source).not.toMatch(/PLAN_AMOUNTS/);
    expect(source).toContain("planPriceCents(input.plan)");
  });

  it("o handler e o schema não inventam fallback nem aritmética sobre o preço", () => {
    // `planPriceCents(plan) ?? 9900` (ou `* 10`, `- 100`…) passaria no check de
    // literal acima — o valor inventado não é o valor corrente. O preço tem de
    // sair direto do JSON, sem fallback nem manipulação no caminho.
    for (const file of [SUBSCRIPTION_HANDLER, SUBSCRIPTION_SCHEMAS]) {
      const source = read(file);
      expect(source, `${file} usa fallback de preço (??)`).not.toMatch(
        /planPriceCents\([^)]*\)\s*\?\?/,
      );
      expect(source, `${file} faz aritmética sobre o preço`).not.toMatch(
        /planPriceCents\([^)]*\)\s*[+\-*/]/,
      );
    }
  });

  it("PLANS cobre exatamente as chaves do JSON com o mesmo valor", () => {
    expect([...PLAN_SLUGS].sort()).toEqual(Object.keys(planPrices).sort());
    expect(PLANS.map((plan) => plan.slug).sort()).toEqual(
      Object.keys(planPrices).sort(),
    );
    for (const [slug, cents] of Object.entries(planPrices)) {
      expect(getPlan(slug as PlanSlug).price_cents).toBe(cents);
    }
  });
});
