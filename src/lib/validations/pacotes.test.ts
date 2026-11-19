// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";

import {
  SELL_PACKAGE_DEFAULTS,
  sellPackageSchema,
} from "@/lib/validations/pacotes";

describe("sellPackageSchema — venda de pacote (ADR-06)", () => {
  const base = { ...SELL_PACKAGE_DEFAULTS, customerId: "c-1", serviceId: "s-1" };

  it("aceita venda válida", () => {
    const parsed = sellPackageSchema.safeParse({
      ...base,
      totalSessions: 5,
      priceCents: 60000,
      validityDays: 30,
    });
    expect(parsed.success).toBe(true);
  });

  it("barra total de sessões zerado", () => {
    const parsed = sellPackageSchema.safeParse({ ...base, totalSessions: 0 });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues[0]?.message).toMatch(/pelo menos 1 sessão/);
    }
  });

  it("barra preço negativo e exige cliente e serviço", () => {
    const parsed = sellPackageSchema.safeParse({
      ...base,
      customerId: "",
      serviceId: "",
      priceCents: -1,
    });
    expect(parsed.success).toBe(false);
  });

  it("barra validade zerada", () => {
    const parsed = sellPackageSchema.safeParse({ ...base, validityDays: 0 });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues[0]?.message).toMatch(/pelo menos 1 dia/);
    }
  });

  it("preço zero é válido (cortesia)", () => {
    const parsed = sellPackageSchema.safeParse({ ...base, priceCents: 0 });
    expect(parsed.success).toBe(true);
  });
});
