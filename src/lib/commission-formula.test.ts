import { describe, expect, it } from "vitest";

import {
  calcServiceCommissionCents,
  calcProductCommissionCents,
  calcComboCommissionCents,
} from "@/lib/commission-formula";

describe("commission-formula", () => {
  it("price: round(price * pct / 100)", () => {
    expect(
      calcServiceCommissionCents({
        priceCents: 10000,
        commissionPct: 40,
        commissionType: "price",
      }),
    ).toBe(4000);
  });
  it("margin: round((price-backbar)*pct/100), min 0", () => {
    expect(
      calcServiceCommissionCents({
        priceCents: 10000,
        commissionPct: 40,
        commissionType: "margin",
        backbarCostCents: 2000,
      }),
    ).toBe(3200);
    expect(
      calcServiceCommissionCents({
        priceCents: 1000,
        commissionPct: 40,
        commissionType: "margin",
        backbarCostCents: 2000,
      }),
    ).toBe(0);
  });
  it("product", () => {
    expect(
      calcProductCommissionCents({ priceCents: 1000, qty: 2, commissionPct: 10 }),
    ).toBe(200);
  });
  it("combo", () => {
    expect(calcComboCommissionCents({ priceCents: 5000, commissionPct: 30 })).toBe(
      1500,
    );
  });
});