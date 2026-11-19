import { describe, expect, it } from "vitest";

import {
  applyDepositEntitlement,
  professionalSchema,
  type ServiceInput,
} from "@/lib/validations/catalog";

/**
 * Cobertura do campo opcional `commissionBps` do `professionalSchema` (ADR-06).
 * A % de comissão é opcional (só entra no form de barbearia); quando presente,
 * espelha o CHECK 0–100 do banco em base points inteiros (0–10000).
 */
describe("professionalSchema.commissionBps", () => {
  const base = { name: "Dra. Ana", active: true } as const;

  it("aceita o cadastro sem comissão (opcional para clínica/salão/legado)", () => {
    const parsed = professionalSchema.parse(base);
    expect(parsed.commissionBps).toBeUndefined();
  });

  it("aceita bps dentro de 0–10000", () => {
    expect(professionalSchema.parse({ ...base, commissionBps: 0 }).commissionBps).toBe(0);
    expect(professionalSchema.parse({ ...base, commissionBps: 4000 }).commissionBps).toBe(4000);
    expect(professionalSchema.parse({ ...base, commissionBps: 10000 }).commissionBps).toBe(10000);
  });

  it("recusa bps fora de 0–10000", () => {
    expect(professionalSchema.safeParse({ ...base, commissionBps: -1 }).success).toBe(false);
    expect(professionalSchema.safeParse({ ...base, commissionBps: 10001 }).success).toBe(false);
  });

  it("recusa bps não inteiro", () => {
    expect(professionalSchema.safeParse({ ...base, commissionBps: 12.5 }).success).toBe(false);
  });
});

/**
 * Strip de entitlement do depósito (ADR-12 §4): sem `deposito` liberado, o
 * submit do ServiceFormDialog nunca envia config editável.
 */
describe("applyDepositEntitlement", () => {
  const base: ServiceInput = {
    name: "Corte",
    durationMinutes: 30,
    processingMinutes: 0,
    priceCents: 10000,
    backbarCostCents: 0,
    active: true,
    deposit: {
      enabled: true,
      type: "percent",
      value: 30,
      deadlineHours: 48,
      refundPolicy: "total",
      refundPercent: null,
    },
  };

  it("sem entitlement: força o bloco desabilitado", () => {
    const sanitized = applyDepositEntitlement(base, false);
    expect(sanitized.deposit?.enabled).toBe(false);
    expect(sanitized.deposit?.type).toBeNull();
    // Demais campos do serviço passam intactos.
    expect(sanitized.name).toBe("Corte");
    expect(sanitized.priceCents).toBe(10000);
  });

  it("com entitlement: passa o input intacto", () => {
    expect(applyDepositEntitlement(base, true)).toEqual(base);
  });
});
