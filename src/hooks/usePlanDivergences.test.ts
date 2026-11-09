// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";

import {
  PLAN_DIVERGENCES_KEY,
  planDivergenceListSchema,
} from "@/hooks/usePlanDivergences";

/**
 * C1 (code-review loop 1/3): divergências de plano saem da view
 * `v_charges_pagas_sem_plano` pelo RPC `admin_get_plan_divergences`
 * (super_admin, guard interno) — nunca por select direto na view
 * (revogada para anon/authenticated + security_invoker).
 * Aqui provamos o contrato: chave de cache + shape zod da resposta.
 */

const VALID_ROW = {
  charge_id: "11111111-1111-4111-8111-111111111111",
  tenant_id: "22222222-2222-4222-8222-222222222222",
  charge_plan: "pro",
  current_plan: "individual",
  amount_cents: 25900,
  paid_at: "2026-11-01T12:00:00+00",
};

describe("PLAN_DIVERGENCES_KEY", () => {
  it("chave de cache estável do backoffice", () => {
    expect(PLAN_DIVERGENCES_KEY).toEqual(["admin", "plan-divergences"]);
  });
});

describe("planDivergenceListSchema", () => {
  it("aceita linha válida do RPC", () => {
    expect(planDivergenceListSchema.parse([VALID_ROW])).toEqual([VALID_ROW]);
  });

  it("aceita charge_plan nulo e paid_at nulo", () => {
    const row = { ...VALID_ROW, charge_plan: null, paid_at: null };
    expect(planDivergenceListSchema.parse([row])).toEqual([row]);
  });

  it("aceita lista vazia (sem divergência)", () => {
    expect(planDivergenceListSchema.parse([])).toEqual([]);
  });

  it("recusa linha com plano fora do enum (dado não confiável)", () => {
    expect(() =>
      planDivergenceListSchema.parse([{ ...VALID_ROW, current_plan: "enterprise" }]),
    ).toThrow();
  });

  it("recusa amount_cents não numérico", () => {
    expect(() =>
      planDivergenceListSchema.parse([{ ...VALID_ROW, amount_cents: "25900" }]),
    ).toThrow();
  });
});
