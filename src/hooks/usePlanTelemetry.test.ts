// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";

import type { QuotaHotRow } from "@/hooks/usePlanTelemetry";
import {
  currentTelemetryMonth,
  formatMrrCents,
  formatRate,
  isPlanFilter,
  isValidTelemetryMonth,
  quotaRowRatio,
  sortQuotaHot,
} from "@/hooks/usePlanTelemetry";

function row(partial: Partial<QuotaHotRow> & { tenant_id: string }): QuotaHotRow {
  return {
    trade_name: null,
    plan: "individual",
    profs: 0,
    prof_limit: 1,
    appts: 0,
    appt_limit: 150,
    month_key: "2026-11",
    ...partial,
  };
}

describe("isValidTelemetryMonth", () => {
  it("aceita YYYY-MM válido", () => {
    expect(isValidTelemetryMonth("2026-11")).toBe(true);
  });

  it("rejeita mês 13 e formato livre (anti-injeção)", () => {
    expect(isValidTelemetryMonth("2026-13")).toBe(false);
    expect(isValidTelemetryMonth("2026-11'; DROP--")).toBe(false);
    expect(isValidTelemetryMonth("")).toBe(false);
  });
});

describe("currentTelemetryMonth", () => {
  it("devolve YYYY-MM no fuso default", () => {
    expect(currentTelemetryMonth()).toMatch(/^[0-9]{4}-(0[1-9]|1[0-2])$/);
  });
});

describe("isPlanFilter", () => {
  it("aceita slugs e todos; rejeita livre", () => {
    expect(isPlanFilter("individual")).toBe(true);
    expect(isPlanFilter("todos")).toBe(true);
    expect(isPlanFilter("diamond")).toBe(false);
  });
});

describe("formatRate (zero-division → —)", () => {
  it("null/NaN vira —, nunca 0%/NaN", () => {
    expect(formatRate(null)).toBe("—");
    expect(formatRate(undefined)).toBe("—");
    expect(formatRate(Number.NaN)).toBe("—");
  });

  it("formata pt-BR com 1 casa", () => {
    expect(formatRate(12.345)).toBe("12,3%");
  });
});

describe("formatMrrCents", () => {
  it("null vira — (Sem pagantes), nunca R$0 falso", () => {
    expect(formatMrrCents(null)).toBe("—");
  });

  it("formata BRL tabular", () => {
    expect(formatMrrCents(5900)).toContain("59");
  });
});

describe("quotaRowRatio / sortQuotaHot", () => {
  it("usa o maior entre profs e appts", () => {
    const r = row({ tenant_id: "a", profs: 1, prof_limit: 1, appts: 75, appt_limit: 150 });
    expect(quotaRowRatio(r)).toBe(1);
  });

  it("null quando sem limite nos dois", () => {
    const r = row({ tenant_id: "a", prof_limit: null, appt_limit: null });
    expect(quotaRowRatio(r)).toBeNull();
  });

  it("ordena % desc", () => {
    const rows = [
      row({ tenant_id: "frio", profs: 0, appts: 0 }),
      row({ tenant_id: "quente", profs: 1, prof_limit: 1 }),
    ];
    expect(sortQuotaHot(rows).map((r) => r.tenant_id)).toEqual(["quente", "frio"]);
  });
});

describe("só RPC (sem .from nas views)", () => {
  it("hook usa supabase.rpc", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const source = fs.readFileSync(
      path.resolve(process.cwd(), "src/hooks/usePlanTelemetry.ts"),
      "utf8",
    );
    expect(source).not.toMatch(/supabase\s*\.\s*from\s*\(/);
    expect(source).toMatch(/admin_get_plan_mrr/);
    expect(source).toMatch(/admin_get_trial_conversion/);
    expect(source).toMatch(/admin_get_quota_utilization/);
    expect(source).toMatch(/admin_get_churn_por_plano/);
  });
});
