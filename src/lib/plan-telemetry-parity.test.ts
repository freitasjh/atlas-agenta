// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Paridade telemetria × catálogo SSoT (T1.0b). O preço do plano sai da tabela
 * `public.plans`; o frontend consome via RPC `get_plans()` (Batch 0.3) e o
 * `plans.json` foi removido. Este teste trava:
 *
 *   1. seed final (rename aplicado) × fallback do frontend, por slug novo;
 *   2. `plan_price_cents` lendo a tabela (sem CASE de literais);
 *   3. views de telemetria sem grant (leitura só via RPC);
 *   4. hook de telemetria sem acesso direto a tabela (só RPC);
 *   5. filtro `p_plan` da telemetria com o ladder novo.
 */

const ROOT = process.cwd();
const TELEMETRY_MIGRATION = resolve(
  ROOT,
  "supabase/migrations/20261108150000_plan_telemetry.sql",
);
const CATALOG_MIGRATION = resolve(
  ROOT,
  "supabase/migrations/20261114000000_plan_catalog_ssot.sql",
);
const RENAME_MIGRATION = resolve(
  ROOT,
  "supabase/migrations/20261115000000_plan_rename_ladder.sql",
);

const FINAL_PRICES: Record<string, number> = {
  free: 0,
  starter: 5900,
  premium: 14900,
  enterprise: 25900,
};

function read(path: string): string {
  return readFileSync(path, "utf8");
}

describe("plan-telemetry — paridade de preço com o catálogo SSoT", () => {
  it("seed final espelha cada slug novo → centavos", () => {
    // O seed T1.0 usa os slugs antigos e a migration de rename os migra via
    // UPDATE (histórico preservado): o estado final é seed mapeado + free.
    const seedRe = /'([a-z0-9_-]+)',\s*'[^']*',\s*(\d+),\s*(\d+|null),\s*(\d+|null),/g;
    const original = new Map<string, number>();
    for (const match of read(CATALOG_MIGRATION).matchAll(seedRe)) {
      original.set(match[1], Number(match[2]));
    }
    const renameSource = read(RENAME_MIGRATION);
    const pairRe =
      /update\s+public\.plans\s+set\s+slug\s*=\s*'([a-z0-9_-]+)'[^;]*?where\s+slug\s*=\s*'([a-z0-9_-]+)'/gs;
    const final = new Map<string, number>();
    for (const [slug, price] of original) final.set(slug, price);
    for (const match of renameSource.matchAll(pairRe)) {
      const price = final.get(match[2]);
      final.delete(match[2]);
      if (price !== undefined) final.set(match[1], price);
    }
    const freeRe = /'free',\s*'[^']*',\s*(\d+)\b/.exec(renameSource);
    if (freeRe) final.set("free", Number(freeRe[1]));
    for (const [slug, cents] of Object.entries(FINAL_PRICES)) {
      expect(final.get(slug), `seed final sem '${slug}' → ${cents}`).toBe(cents);
    }
  });

  it("plan_price_cents lê a tabela plans (não há CASE de literais)", () => {
    const source = read(CATALOG_MIGRATION);
    const fn = source.slice(
      source.indexOf("create or replace function public.plan_price_cents"),
      source.indexOf("comment on function public.plan_price_cents"),
    );
    expect(fn).toContain("from public.plans");
    expect(fn).not.toMatch(/\bthen\s+\d+\b/);
  });

  it("filtro p_plan da telemetria usa o ladder novo", () => {
    const source = read(RENAME_MIGRATION);
    expect(source).toContain(
      "p_plan not in ('free','starter','premium','enterprise')",
    );
  });

  it("nenhum GRANT SELECT nas views de telemetria", () => {
    const source = read(TELEMETRY_MIGRATION);
    for (const view of [
      "v_plan_mrr",
      "v_trial_conversion_por_plano",
      "v_quota_utilization",
      "v_churn_por_plano",
    ]) {
      expect(source).not.toMatch(new RegExp(`grant\\s+select[^;]*${view}`, "i"));
    }
  });

  it("nenhum acesso direto a tabela pelo cliente novo (só RPC)", () => {
    const hook = readFileSync(
      resolve(ROOT, "src/hooks/usePlanTelemetry.ts"),
      "utf8",
    );
    expect(hook).not.toMatch(/supabase\s*\.\s*from\s*\(/);
    expect(hook).toMatch(/\.rpc\s*\(/);
  });

  it("nenhuma referência a plans.json no frontend", () => {
    const plans = readFileSync(resolve(ROOT, "src/lib/plans.ts"), "utf8");
    expect(plans).not.toContain("plans.json");
  });
});
