import { describe, expect, it } from "vitest";
import type { Role } from "@/types/domain";
import type { DaySummary } from "@/app/agenda/model/daySummary";
import {
  canSeeFinancials,
  maskDaySummaryForRole,
  maskFinancials,
} from "@/app/agenda/model/financialMask";

const base: DaySummary = {
  ocupacaoPct: 50,
  horariosOcupados: 10,
  capacidade: 20,
  previstoCents: 15000,
  numAtendimentos: 10,
  aConfirmar: 2,
  riscoNoShow: 3,
};

describe("canSeeFinancials", () => {
  it.each([["admin"], ["super_admin"], ["professional"]] as Role[][])(
    "%s vê valores",
    (role) => {
      expect(canSeeFinancials(role as Role)).toBe(true);
    },
  );

  it("receptionist não vê valores", () => {
    expect(canSeeFinancials("receptionist")).toBe(false);
  });
});

describe("maskFinancials", () => {
  it("receptionist → null", () => {
    expect(maskFinancials("receptionist", 15000)).toBeNull();
  });

  it("admin/professional recebem valor", () => {
    expect(maskFinancials("admin", 15000)).toBe(15000);
    expect(maskFinancials("professional", 15000)).toBe(15000);
    expect(maskFinancials("super_admin", 15000)).toBe(15000);
  });
});

describe("maskDaySummaryForRole", () => {
  it("receptionist recebe previstoCents=null, resto intacto", () => {
    const masked = maskDaySummaryForRole(base, "receptionist");
    expect(masked.previstoCents).toBeNull();
    expect(masked.ocupacaoPct).toBe(50);
    expect(masked.aConfirmar).toBe(2);
    expect(masked.riscoNoShow).toBe(3);
  });

  it("admin recebe valor cheio", () => {
    const masked = maskDaySummaryForRole(base, "admin");
    expect(masked.previstoCents).toBe(15000);
  });

  it("não muta o objeto original", () => {
    maskDaySummaryForRole(base, "receptionist");
    expect(base.previstoCents).toBe(15000);
  });
});
