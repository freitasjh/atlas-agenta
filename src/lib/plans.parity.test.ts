import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { PLAN_PRESENTATION_LIMITS } from "@/hooks/useSetPlan";
import { PLAN_SLUGS, PLANS, getPlan, type PlanSlug } from "@/lib/plans";

/**
 * Guard da fonte única de planos (T1.0b). A SSoT é a tabela `public.plans`,
 * lida pelo frontend via RPC `get_plans()` (hook `usePlansCatalog`) com
 * fallback estático em `src/lib/plans.ts`. O `plans.json` deixou de existir
 * no Batch 0.3 — este teste trava:
 *
 *   1. seed da migration de rename × fallback do frontend (preço/quotas);
 *   2. quotas do seed × `PLAN_PRESENTATION_LIMITS` da UI;
 *   3. ausência do `plans.json` (fonte removida) e de sua importação;
 *   4. ausência dos slugs antigos (`individual/clinica/pro`) nas fontes
 *      escopadas a plano (frontend lib/hooks + Edge admin-plan +
 *      migration de rename, onde só aparecem no mapeamento histórico).
 *
 * Mesmo padrão do `suite-command.spec.mjs`: lê os arquivos e falha na
 * divergência, em vez de confiar em comentário.
 */

const ROOT = process.cwd();
const SRC_PLANS = resolve(ROOT, "src/lib/plans.ts");
const SET_PLAN_HOOK = resolve(ROOT, "src/hooks/useSetPlan.ts");
const ADMIN_PLAN_VALIDATIONS = resolve(ROOT, "src/lib/validations/admin-plan.ts");
const EDGE_ADMIN_PLAN_SCHEMAS = resolve(ROOT, "supabase/functions/admin-plan/schemas.ts");
const RENAME_MIGRATION = resolve(
  ROOT,
  "supabase/migrations/20261115000000_plan_rename_ladder.sql",
);
const CATALOG_MIGRATION = resolve(
  ROOT,
  "supabase/migrations/20261114000000_plan_catalog_ssot.sql",
);
const PLANS_JSON = resolve(ROOT, "supabase/functions/_shared/plans.json");

function read(path: string): string {
  return readFileSync(path, "utf8");
}

/** Linhas do seed: `('slug', 'Nome', preco, prof, appt,`. */
function seedRows(source: string): Array<{
  slug: string;
  price: number;
  prof: number | null;
  appt: number | null;
}> {
  const rows: Array<{ slug: string; price: number; prof: number | null; appt: number | null }> = [];
  const re = /'([a-z0-9_-]+)',\s*'[^']*',\s*(\d+),\s*(\d+|null),\s*(\d+|null),/g;
  for (const match of source.matchAll(re)) {
    rows.push({
      slug: match[1],
      price: Number(match[2]),
      prof: match[3] === "null" ? null : Number(match[3]),
      appt: match[4] === "null" ? null : Number(match[4]),
    });
  }
  return rows;
}

/** UPDATEs do rename: `update ... set slug = 'novo'` + `where slug = 'antigo'`. */
function renamePairs(source: string): Array<{ from: string; to: string }> {
  const pairs: Array<{ from: string; to: string }> = [];
  const re = /update\s+public\.plans\s+set\s+slug\s*=\s*'([a-z0-9_-]+)'[^;]*?where\s+slug\s*=\s*'([a-z0-9_-]+)'/gs;
  for (const match of source.matchAll(re)) {
    pairs.push({ from: match[2], to: match[1] });
  }
  return pairs;
}

describe("plans — SSoT no backend (tabela plans)", () => {
  it("plans.json foi removido (Batch 0.3 consome via RPC)", () => {
    expect(existsSync(PLANS_JSON), "plans.json ainda existe").toBe(false);
    expect(read(SRC_PLANS)).not.toContain("plans.json");
  });

  it("migration de rename mapeia o ladder antigo → novo", () => {
    const pairs = renamePairs(read(RENAME_MIGRATION));
    expect(pairs).toContainEqual({ from: "individual", to: "starter" });
    expect(pairs).toContainEqual({ from: "clinica", to: "premium" });
    expect(pairs).toContainEqual({ from: "pro", to: "enterprise" });
  });

  it("migration de rename recria os CHECKs com o ladder novo + free", () => {
    const source = read(RENAME_MIGRATION);
    expect(source).toContain("check (plan in ('free','starter','premium','enterprise'))");
    expect(source).toContain(
      "check (plan is null or plan in ('free','starter','premium','enterprise'))",
    );
    expect(source).toContain("check (old_plan in ('free','starter','premium','enterprise'))");
    expect(source).toContain("check (new_plan in ('free','starter','premium','enterprise'))");
    expect(source).toContain("p_new_plan not in ('free','starter','premium','enterprise')");
  });

  it("catalog migration + rename preservam o histórico (tabela plans final)", () => {
    const seed = seedRows(read(CATALOG_MIGRATION));
    const pairs = new Map(renamePairs(read(RENAME_MIGRATION)).map((p) => [p.from, p.to]));
    const finalSlugs = new Set(
      seed.map((row) => pairs.get(row.slug) ?? row.slug),
    );
    expect(finalSlugs).toEqual(new Set(["free", "starter", "premium", "enterprise"]));
  });
});

describe("plans — paridade do seed (tabela × frontend)", () => {
  const seed = seedRows(read(RENAME_MIGRATION).match(/insert into public\.plans[\s\S]*?on conflict \(slug\) do nothing;/)?.[0] ?? "");

  it("seed do free na migration de rename (1 prof / 30 appt / R$ 0)", () => {
    const free = seed.find((row) => row.slug === "free");
    expect(free, "seed sem o slug free").toBeDefined();
    expect(free).toMatchObject({ price: 0, prof: 1, appt: 30 });
  });

  it("preço do fallback espelha o catálogo final", () => {
    const expected: Record<PlanSlug, number> = {
      free: 0,
      starter: 5900,
      premium: 14900,
      enterprise: 25900,
    };
    for (const [slug, cents] of Object.entries(expected)) {
      expect(getPlan(slug as PlanSlug).price_cents, `fallback sem ${slug}`).toBe(cents);
    }
  });

  it("quotas do seed espelham os limites apresentados na UI", () => {
    // free vem do insert da migration de rename; starter/premium/enterprise
    // vêm do rename do seed T1.0 (preço/quotas preservados).
    const original = seedRows(read(CATALOG_MIGRATION));
    const pairs = new Map(renamePairs(read(RENAME_MIGRATION)).map((p) => [p.from, p.to]));
    const byFinal = new Map(
      original.map((row) => [(pairs.get(row.slug) ?? row.slug) as PlanSlug, row]),
    );
    for (const [slug, limits] of Object.entries(PLAN_PRESENTATION_LIMITS)) {
      if (slug === "free") continue;
      expect(byFinal.get(slug as PlanSlug), `seed sem ${slug}`).toBeDefined();
      expect(byFinal.get(slug as PlanSlug)).toMatchObject({ prof: limits.prof, appt: limits.appt });
    }
    expect(PLAN_PRESENTATION_LIMITS.free).toEqual({ prof: 1, appt: 30 });
  });

  it("PLANS cobre exatamente os slugs do ladder", () => {
    expect(PLANS.map((plan) => plan.slug).sort()).toEqual([...PLAN_SLUGS].sort());
  });
});

describe("plans — slugs antigos removidos das fontes de plano", () => {
  const PLAN_SCOPED = [SRC_PLANS, SET_PLAN_HOOK, ADMIN_PLAN_VALIDATIONS, EDGE_ADMIN_PLAN_SCHEMAS];

  it.each(PLAN_SCOPED)("%s: sem 'individual' como valor de plano", (path) => {
    // O mapeamento histórico pode aparecer em comentário/documentação;
    // como valor (literal com aspas) o slug antigo não pode existir.
    expect(read(path), `slug antigo em ${path}`).not.toMatch(/['"]individual['"]/);
  });

  it.each(PLAN_SCOPED)("%s: sem 'clinica' como slug de plano", (path) => {
    // `clinica` sobrevive como segmento de negócio (BUSINESS_SEGMENTS) e em
    // labels de ramo — mas nunca nestas fontes escopadas a plano.
    expect(read(path), `slug antigo em ${path}`).not.toMatch(/['"]clinica['"]/);
  });
});
