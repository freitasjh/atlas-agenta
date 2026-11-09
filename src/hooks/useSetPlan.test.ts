// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";

import { isUsageOverPlan, PLAN_PRESENTATION_LIMITS } from "@/hooks/useSetPlan";
import { PLAN_SLUGS, type PlanSlug } from "@/lib/plans";

describe("PLAN_PRESENTATION_LIMITS", () => {
  it("individual 1 prof / 150 agend", () => {
    expect(PLAN_PRESENTATION_LIMITS.individual).toEqual({ prof: 1, appt: 150 });
  });

  it("clinica 5 prof / ilimitado", () => {
    expect(PLAN_PRESENTATION_LIMITS.clinica).toEqual({ prof: 5, appt: null });
  });

  it("pro ilimitado", () => {
    expect(PLAN_PRESENTATION_LIMITS.pro).toEqual({ prof: null, appt: null });
  });
});

describe("isUsageOverPlan", () => {
  it("4 profs estoura individual", () => {
    expect(
      isUsageOverPlan({ active_professionals: 4, month_appointments: 10 }, "individual"),
    ).toBe(true);
  });

  it("151 agend estoura individual", () => {
    expect(
      isUsageOverPlan({ active_professionals: 1, month_appointments: 151 }, "individual"),
    ).toBe(true);
  });

  it("dentro do limite libera", () => {
    expect(
      isUsageOverPlan({ active_professionals: 1, month_appointments: 150 }, "individual"),
    ).toBe(false);
  });

  it("pro nunca estoura", () => {
    expect(
      isUsageOverPlan({ active_professionals: 99, month_appointments: 9999 }, "pro"),
    ).toBe(false);
  });

  it("sem uso não bloqueia", () => {
    expect(isUsageOverPlan(null, "individual")).toBe(false);
    expect(isUsageOverPlan(undefined, "individual")).toBe(false);
  });
});

/**
 * Follow-up (code-review loop 1/3): paridade apresentação × SQL.
 * `PLAN_PRESENTATION_LIMITS` (UI, só trava Confirmar sem override) precisa
 * espelhar `plan_professional_limit()` / `plan_appointment_limit()` do banco
 * (trava canônica fail-closed). Se o SQL mudar, este teste quebra e força
 * atualizar a UI junto — sem drift silencioso.
 */
describe("PLAN_PRESENTATION_LIMITS × SQL (paridade)", () => {
  // Espelho de:
  //   plan_professional_limit: individual→1, clinica→5, pro→null
  //   plan_appointment_limit: individual→150, clinica→null, pro→null
  const SQL_LIMITS: Record<PlanSlug, { prof: number | null; appt: number | null }> = {
    individual: { prof: 1, appt: 150 },
    clinica: { prof: 5, appt: null },
    pro: { prof: null, appt: null },
  };

  it.each(PLAN_SLUGS)("plano %s: UI espelha o SQL", (plan) => {
    expect(PLAN_PRESENTATION_LIMITS[plan]).toEqual(SQL_LIMITS[plan]);
  });
});
