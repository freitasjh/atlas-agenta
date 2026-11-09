// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";

import { mapPlanError } from "@/lib/plan-errors";

describe("mapPlanError", () => {
  it("401 vira sessão expirada", () => {
    expect(mapPlanError({ status: 401, message: "401 JWT expired" })).toBe(
      "Sua sessão expirada. Entre novamente.",
    );
  });

  it("403 vira sem permissão", () => {
    expect(mapPlanError({ status: 403, message: "forbidden" })).toBe(
      "Sem permissão para esta ação.",
    );
  });

  it("PLAN_LIMIT repassa detalhe pt-BR do servidor", () => {
    const msg = mapPlanError({
      status: 409,
      message: "PLAN_LIMIT: Limite do plano individual: máximo 1 profissional ativo.",
    });
    expect(msg).toContain("Limite do plano");
  });

  it("same_plan vira mensagem dedicada", () => {
    expect(mapPlanError({ status: 409, message: "same_plan" })).toBe(
      "A empresa já está neste plano.",
    );
  });

  it("reason curta vira mensagem de mínimo", () => {
    expect(mapPlanError({ status: 400, message: "reason_too_short" })).toBe(
      "O motivo deve ter pelo menos 10 caracteres.",
    );
  });

  it("404 vira empresa não encontrada", () => {
    expect(mapPlanError({ status: 404, message: "tenant_not_found" })).toBe(
      "Empresa não encontrada.",
    );
  });

  it("desconhecido cai no genérico sem vazar PII", () => {
    expect(mapPlanError({ message: "boom" })).toBe(
      "Não foi possível alterar o plano. Tente novamente.",
    );
  });
});
