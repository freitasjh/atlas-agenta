import { describe, expect, it } from "vitest";

import { walkInSchema } from "@/lib/validations/pdv";

const PROF = "44444444-4444-4444-4444-444444444444";
const SERVICE = "55555555-5555-5555-5555-555555555555";
const COMBO = "77777777-7777-7777-7777-777777777777";

describe("walkInSchema — PDV balcão (ADR-23)", () => {
  it("aceita venda anônima (serviço + profissional, sem cliente)", () => {
    const parsed = walkInSchema.safeParse({
      professionalId: PROF,
      selection: { kind: "service", serviceId: SERVICE },
      customerName: "",
      customerPhone: "",
      whatsappOptIn: false,
    });
    expect(parsed.success).toBe(true);
  });

  it("aceita combo em v1 (1 serviço OU 1 combo)", () => {
    const parsed = walkInSchema.safeParse({
      professionalId: PROF,
      selection: { kind: "combo", comboId: COMBO },
      whatsappOptIn: false,
    });
    expect(parsed.success).toBe(true);
  });

  it("aceita cliente identificado (nome + telefone)", () => {
    const parsed = walkInSchema.safeParse({
      professionalId: PROF,
      selection: { kind: "service", serviceId: SERVICE },
      customerName: "Ana",
      customerPhone: "(11) 99999-8888",
      whatsappOptIn: true,
    });
    expect(parsed.success).toBe(true);
  });

  it("rejeita sem profissional", () => {
    const parsed = walkInSchema.safeParse({
      professionalId: "",
      selection: { kind: "service", serviceId: SERVICE },
      whatsappOptIn: false,
    });
    expect(parsed.success).toBe(false);
  });

  it("rejeita sem serviço", () => {
    const parsed = walkInSchema.safeParse({
      professionalId: PROF,
      selection: { kind: "service", serviceId: "" },
      whatsappOptIn: false,
    });
    expect(parsed.success).toBe(false);
  });

  it("rejeita nome sem telefone (identificação pela metade)", () => {
    const parsed = walkInSchema.safeParse({
      professionalId: PROF,
      selection: { kind: "service", serviceId: SERVICE },
      customerName: "Ana",
      customerPhone: "",
      whatsappOptIn: false,
    });
    expect(parsed.success).toBe(false);
  });
});
