// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import planPrices from "../../supabase/functions/_shared/plans.json";

/**
 * Paridade telemetria × plans.json (TEL-BE-02): o CASE de
 * `plan_price_cents` na migration precisa espelhar slug → centavos da fonte
 * única. Trava literais 5900/14900/25900 via valores do JSON (sem hardcode
 * no teste: lê o próprio JSON).
 */

const ROOT = process.cwd();
const MIGRATION = resolve(
  ROOT,
  "supabase/migrations/20261108150000_plan_telemetry.sql",
);

function read(): string {
  return readFileSync(MIGRATION, "utf8");
}

describe("plan-telemetry — paridade de preço com plans.json", () => {
  it("migration espelha cada slug → centavos do JSON", () => {
    const source = read();
    for (const [slug, cents] of Object.entries(planPrices)) {
      expect(
        source,
        `migration sem "when '${slug}' then ${cents}"`,
      ).toMatch(new RegExp(`when\\s+'${slug}'\\s+then\\s+${cents}\\b`));
    }
  });

  it("comentário declara a fonte única", () => {
    expect(read()).toContain("supabase/functions/_shared/plans.json");
  });

  it("nenhum GRANT SELECT nas views de telemetria", () => {
    const source = read();
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
});
