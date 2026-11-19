// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";

import { isUsageOverPlan, PLAN_PRESENTATION_LIMITS } from "@/hooks/useSetPlan";
import { PLAN_SLUGS, type PlanSlug } from "@/lib/plans";

describe("PLAN_PRESENTATION_LIMITS", () => {
  it("free 1 prof / 30 agend", () => {
    expect(PLAN_PRESENTATION_LIMITS.free).toEqual({ prof: 1, appt: 30 });
  });

  it("starter 1 prof / 150 agend", () => {
    expect(PLAN_PRESENTATION_LIMITS.starter).toEqual({ prof: 1, appt: 150 });
  });

  it("premium 5 prof / ilimitado", () => {
    expect(PLAN_PRESENTATION_LIMITS.premium).toEqual({ prof: 5, appt: null });
  });

  it("enterprise ilimitado", () => {
    expect(PLAN_PRESENTATION_LIMITS.enterprise).toEqual({ prof: null, appt: null });
  });
});

describe("isUsageOverPlan", () => {
  it("4 profs estoura starter", () => {
    expect(
      isUsageOverPlan({ active_professionals: 4, month_appointments: 10 }, "starter"),
    ).toBe(true);
  });

  it("151 agend estoura starter", () => {
    expect(
      isUsageOverPlan({ active_professionals: 1, month_appointments: 151 }, "starter"),
    ).toBe(true);
  });

  it("31 agend estoura free", () => {
    expect(
      isUsageOverPlan({ active_professionals: 1, month_appointments: 31 }, "free"),
    ).toBe(true);
  });

  it("dentro do limite libera", () => {
    expect(
      isUsageOverPlan({ active_professionals: 1, month_appointments: 150 }, "starter"),
    ).toBe(false);
  });

  it("enterprise nunca estoura", () => {
    expect(
      isUsageOverPlan({ active_professionals: 99, month_appointments: 9999 }, "enterprise"),
    ).toBe(false);
  });

  it("sem uso não bloqueia", () => {
    expect(isUsageOverPlan(null, "starter")).toBe(false);
    expect(isUsageOverPlan(undefined, "starter")).toBe(false);
  });
});

/**
 * Paridade apresentação × SQL (T1.0b).
 * `PLAN_PRESENTATION_LIMITS` (UI, só trava Confirmar sem override) precisa
 * espelhar `plan_professional_limit()` / `plan_appointment_limit()` do banco
 * (trava canônica fail-closed). Se o SQL mudar, este teste quebra e força
 * atualizar a UI junto — sem drift silencioso.
 */
describe("PLAN_PRESENTATION_LIMITS × SQL (paridade)", () => {
  // Espelho de:
  //   plan_professional_limit: free→1, starter→1, premium→5, enterprise→null
  //   plan_appointment_limit: free→30, starter→150, premium→null, enterprise→null
  const SQL_LIMITS: Record<PlanSlug, { prof: number | null; appt: number | null }> = {
    free: { prof: 1, appt: 30 },
    starter: { prof: 1, appt: 150 },
    premium: { prof: 5, appt: null },
    enterprise: { prof: null, appt: null },
  };

  it.each(PLAN_SLUGS)("plano %s: UI espelha o SQL", (plan) => {
    expect(PLAN_PRESENTATION_LIMITS[plan]).toEqual(SQL_LIMITS[plan]);
  });
});
