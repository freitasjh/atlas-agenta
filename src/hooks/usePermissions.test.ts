import { describe, expect, it, vi } from "vitest";

const roleRef = vi.hoisted(() => ({ current: "admin" as string | null }));

vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ role: roleRef.current }),
}));

import { usePermissions } from "@/hooks/usePermissions";
import type { Role } from "@/types/domain";

function permissionsFor(role: Role | null) {
  roleRef.current = role;
  return usePermissions();
}

describe("usePermissions — capacidades de pagamento (ADR-004 §8.1)", () => {
  it("admin pode tudo no fechamento", () => {
    expect(permissionsFor("admin")).toMatchObject({
      canRegisterPayments: true,
      canViewFinancials: true,
      canViewOwnPayments: false,
      canCancelCharge: true,
      canConfirmChargeManual: true,
      canVoidPayment: true,
      canViewPaymentTotalsInClosing: true,
    });
  });

  it("recepção registra e cancela PIX, sem finanças/baixa/estorno", () => {
    expect(permissionsFor("receptionist")).toMatchObject({
      canRegisterPayments: true,
      canViewFinancials: false,
      canViewOwnPayments: false,
      canCancelCharge: true,
      canConfirmChargeManual: false,
      canVoidPayment: false,
      canViewPaymentTotalsInClosing: true,
    });
  });

  it("profissional registra e lê os próprios recebimentos, sem cancelar/estornar", () => {
    expect(permissionsFor("professional")).toMatchObject({
      canRegisterPayments: true,
      canViewFinancials: false,
      canViewOwnPayments: true,
      canCancelCharge: false,
      canConfirmChargeManual: false,
      canVoidPayment: false,
      canViewPaymentTotalsInClosing: true,
    });
  });

  it("mantém as capacidades existentes (não regride catálogo/agenda)", () => {
    const admin = permissionsFor("admin");
    expect(admin.canManageCatalog).toBe(true);
    expect(admin.canManageAppointments).toBe(true);
    expect(admin.canViewCommission).toBe(true);
  });

  it("matriz RBAC final (ADR-005 §5): UI esconde, banco nega", () => {
    const matrix: Array<[Role, Record<string, boolean>]> = [
      [
        "admin",
        {
          canRegisterPayments: true,
          canViewPaymentTotalsInClosing: true,
          canViewFinancials: true,
          canViewOwnPayments: false,
          canCancelCharge: true,
          canConfirmChargeManual: true,
          canVoidPayment: true,
          canViewCommission: true,
        },
      ],
      [
        "receptionist",
        {
          canRegisterPayments: true,
          canViewPaymentTotalsInClosing: true,
          canViewFinancials: false,
          canViewOwnPayments: false,
          canCancelCharge: true,
          canConfirmChargeManual: false,
          canVoidPayment: false,
          canViewCommission: false,
        },
      ],
      [
        "professional",
        {
          canRegisterPayments: true,
          canViewPaymentTotalsInClosing: true,
          canViewFinancials: false,
          canViewOwnPayments: true,
          canCancelCharge: false,
          canConfirmChargeManual: false,
          canVoidPayment: false,
          canViewCommission: true,
        },
      ],
    ];
    for (const [role, expected] of matrix) {
      expect(permissionsFor(role)).toMatchObject(expected);
    }
  });

  it("super_admin não ganha capacidades de pagamento", () => {
    expect(permissionsFor("super_admin")).toMatchObject({
      canRegisterPayments: false,
      canViewFinancials: false,
      canCancelCharge: false,
    });
  });
});
