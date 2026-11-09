import { describe, expect, it } from "vitest";

import {
  changePlanFormSchema,
  changePlanResponseSchema,
  tenantPlanUsageSchema,
} from "@/lib/validations/admin-plan";

/** Trava os schemas zod do contrato admin-plan (reason 10..280, override). */

describe("changePlanFormSchema", () => {
  it("motivo com 9 chars falha com mensagem pt-BR de mínimo", () => {
    const result = changePlanFormSchema.safeParse({
      plan: "clinica",
      reason: "a".repeat(9),
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe(
        "O motivo deve ter pelo menos 10 caracteres.",
      );
    }
  });

  it("motivo com 281 chars falha com mensagem pt-BR de máximo", () => {
    const result = changePlanFormSchema.safeParse({
      plan: "clinica",
      reason: "a".repeat(281),
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe(
        "O motivo deve ter no máximo 280 caracteres.",
      );
    }
  });

  it("motivo exatamente 10 passa (após trim)", () => {
    const result = changePlanFormSchema.safeParse({
      plan: "pro",
      reason: `  ${"a".repeat(10)}  `,
    });
    expect(result.success).toBe(true);
  });

  it("motivo ausente falha", () => {
    const result = changePlanFormSchema.safeParse({ plan: "clinica" });
    expect(result.success).toBe(false);
  });

  it("plano ausente falha com mensagem pt-BR", () => {
    const result = changePlanFormSchema.safeParse({
      reason: "motivo válido aqui",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find((i) => i.path[0] === "plan");
      expect(issue?.message).toBe("Selecione o plano destino.");
    }
  });

  it("override default false quando ausente", () => {
    const result = changePlanFormSchema.safeParse({
      plan: "individual",
      reason: "a".repeat(15),
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.override).toBe(false);
  });
});

describe("changePlanResponseSchema", () => {
  it("DTO de sucesso válido passa", () => {
    expect(
      changePlanResponseSchema.safeParse({
        ok: true,
        tenant_id: "11111111-1111-1111-1111-111111111111",
        old_plan: "individual",
        new_plan: "clinica",
      }).success,
    ).toBe(true);
  });

  it("plano fora do enum falha", () => {
    expect(
      changePlanResponseSchema.safeParse({
        ok: true,
        tenant_id: "11111111-1111-1111-1111-111111111111",
        old_plan: "enterprise",
        new_plan: "clinica",
      }).success,
    ).toBe(false);
  });
});

describe("tenantPlanUsageSchema", () => {
  it("uso válido passa", () => {
    expect(
      tenantPlanUsageSchema.safeParse({
        plan: "clinica",
        active_professionals: 4,
        month_appointments: 200,
        month_key: "2026-11",
      }).success,
    ).toBe(true);
  });

  it("contagem negativa falha", () => {
    expect(
      tenantPlanUsageSchema.safeParse({
        plan: "individual",
        active_professionals: -1,
        month_appointments: 0,
        month_key: "2026-11",
      }).success,
    ).toBe(false);
  });
});
