import { describe, expect, it } from "vitest";

import { tenantSchema } from "@/hooks/useTenant";
import { BUSINESS_SEGMENTS } from "@/types/domain";

/**
 * Cobertura do contrato de `segment` no parse do tenant (ADR-03, AC-03.4/AC-03.5).
 * Prova do `.catch(null)`: valor inesperado degrada para `null` (genérico) em
 * vez de derrubar o parse do tenant — nunca transforma dado sujo em negação de
 * acesso.
 */

const baseRow = {
  id: "tenant-1",
  trade_name: "Studio Lux",
  legal_name: "Studio Lux LTDA",
  subscription_status: "ativo" as const,
  timezone: "America/Sao_Paulo",
};

describe("tenantSchema.segment", () => {
  it("AC-03.4: segment conhecido é preservado", () => {
    const out = tenantSchema.parse({ ...baseRow, segment: "clinica" });
    expect(out.segment).toBe("clinica");
  });

  it("AC-03.4: valor inesperado degrada para null (prova do .catch(null))", () => {
    const out = tenantSchema.parse({ ...baseRow, segment: "xpto" });
    expect(out.segment).toBeNull();
  });

  it("AC-03.4: segment null permanece null", () => {
    const out = tenantSchema.parse({ ...baseRow, segment: null });
    expect(out.segment).toBeNull();
  });

  it("AC-03.5: BUSINESS_SEGMENTS é a tripla canônica, idêntica ao check SQL", () => {
    expect([...BUSINESS_SEGMENTS]).toEqual(["barbearia", "clinica", "salao"]);
  });
});
