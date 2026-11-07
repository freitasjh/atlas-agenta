// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AppointmentSettlementDialog } from "@/app/agenda/pagamentos/AppointmentSettlementDialog";
import { paymentsMessages } from "@/app/agenda/pagamentos/payments-messages";

const mocks = vi.hoisted(() => ({
  settlement: { data: null as unknown, isLoading: false, isError: false, refetch: vi.fn() },
  cancel: { mutateAsync: vi.fn(), isPending: false },
  manual: { mutateAsync: vi.fn(), isPending: false },
  voidPayment: { mutateAsync: vi.fn(), isPending: false },
  createCharge: { mutateAsync: vi.fn(), isPending: false },
  permissions: {
    canRegisterPayments: true,
    canViewFinancials: true,
    canViewOwnPayments: false,
    canCancelCharge: true,
    canConfirmChargeManual: true,
    canVoidPayment: true,
    canViewPaymentTotalsInClosing: true,
  },
  onOpenChange: vi.fn(),
  onRegisterPayment: vi.fn(),
}));

vi.mock("@/hooks/useAppointmentPayments", () => ({
  useAppointmentSettlement: () => mocks.settlement,
  useCancelCharge: () => mocks.cancel,
  useConfirmManualCharge: () => mocks.manual,
  useVoidAppointmentPayment: () => mocks.voidPayment,
}));
vi.mock("@/hooks/useCharges", () => ({
  useCreateCharge: () => mocks.createCharge,
}));
vi.mock("@/hooks/usePermissions", () => ({
  usePermissions: () => mocks.permissions,
}));
vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ tenant: { timezone: "America/Sao_Paulo" } }),
}));
vi.mock(["son", "ner"].join(""), () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

const PAYMENT = {
  id: "p-1",
  method: "dinheiro",
  amount_cents: 6000,
  tip_cents: 500,
  source: "manual",
  received_at: "2026-11-06T12:30:00.000Z",
  voided_at: null,
  void_reason: null,
};

const PENDING = {
  id: "ch-1",
  amount_cents: 4000,
  expires_at: "2099-11-09T12:00:00.000Z",
  pix_qr_code: "qr",
  pix_copy_paste: "code",
};

function settlement(overrides: Record<string, unknown> = {}) {
  return {
    appointment: {
      id: "ap-1",
      status: "concluido",
      starts_at: "2026-11-06T12:00:00.000Z",
      customer_name: "Ana",
      service_name: "Corte",
      professional_name: "Bia",
      total_cents: 10000,
    },
    payments: [PAYMENT],
    pending_charges: [PENDING],
    stale_charges: [],
    total_paid_cents: 6000,
    tip_cents: 500,
    reserved_cents: 4000,
    remaining_cents: 0,
    payment_status: "aguardando_pix",
    permissions: {
      can_register: true,
      can_cancel_charge: true,
      can_confirm_manual: true,
      can_void: true,
      can_view_qr: true,
      can_reissue_pix: false,
    },
    ...overrides,
  };
}

function renderDialog() {
  render(
    <AppointmentSettlementDialog
      open
      appointmentId="ap-1"
      onOpenChange={mocks.onOpenChange}
      onRegisterPayment={mocks.onRegisterPayment}
    />,
  );
}

beforeEach(() => {
  mocks.settlement.data = settlement();
  mocks.settlement.isLoading = false;
  mocks.settlement.isError = false;
  mocks.settlement.refetch.mockReset();
  mocks.cancel.mutateAsync.mockReset();
  mocks.cancel.isPending = false;
  mocks.manual.mutateAsync.mockReset();
  mocks.manual.isPending = false;
  mocks.voidPayment.mutateAsync.mockReset();
  mocks.voidPayment.isPending = false;
  mocks.createCharge.mutateAsync.mockReset();
  Object.assign(mocks.permissions, {
    canRegisterPayments: true,
    canCancelCharge: true,
    canConfirmChargeManual: true,
    canVoidPayment: true,
  });
  mocks.onOpenChange.mockReset();
  mocks.onRegisterPayment.mockReset();
});

afterEach(cleanup);

describe("AppointmentSettlementDialog", () => {
  it("carrega e mostra totais/pagamentos em um único dialog", async () => {
    renderDialog();
    await waitFor(() => expect(screen.getByTestId("settlement-payment-p-1")).toBeTruthy());
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    expect(
      screen
        .getByTestId("settlement-remaining")
        .textContent?.replace(/\u00a0/g, " "),
    ).toContain("R$ 0,00");
    expect(
      screen
        .getByTestId("settlement-reserved")
        .textContent?.replace(/\u00a0/g, " "),
    ).toContain("R$ 40,00");
    expect(screen.getByText(paymentsMessages.settlement.balance)).toBeTruthy();
    expect(screen.getByText(paymentsMessages.settlement.pending)).toBeTruthy();
  });

  it("estado de loading é explícito", () => {
    mocks.settlement.data = null;
    mocks.settlement.isLoading = true;
    renderDialog();
    expect(screen.getAllByText(paymentsMessages.settlement.loading).length).toBeGreaterThan(0);
  });

  it("estado de erro oferece retry", () => {
    mocks.settlement.data = null;
    mocks.settlement.isError = true;
    renderDialog();
    expect(screen.getByRole("alert")).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: paymentsMessages.settlement.retry }),
    );
    expect(mocks.settlement.refetch).toHaveBeenCalled();
  });

  it("estado de erro não exibe descrição de loading", () => {
    mocks.settlement.data = null;
    mocks.settlement.isError = true;
    renderDialog();
    expect(screen.queryByText(paymentsMessages.settlement.loading)).toBeNull();
    expect(
      screen.getByText(paymentsMessages.settlement.errorDescription),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: paymentsMessages.settlement.retry }),
    ).toBeTruthy();
  });

  it("sem recebimentos mostra texto positivo", () => {
    mocks.settlement.data = settlement({
      payments: [],
      pending_charges: [],
      stale_charges: [],
      payment_status: "sem_pagamento",
    });
    renderDialog();
    expect(screen.getByText(paymentsMessages.settlement.empty)).toBeTruthy();
  });

  it("respeita permissions.can_void=false (nenhum estorno)", () => {
    mocks.settlement.data = settlement({
      permissions: {
        ...settlement().permissions,
        can_void: false,
      },
    });
    renderDialog();
    expect(
      screen.queryByRole("button", { name: paymentsMessages.void.title }),
    ).toBeNull();
  });

  it("cancelar PIX usa confirmação inline e envia charge_id", async () => {
    mocks.cancel.mutateAsync.mockResolvedValue({ cancelled: true });
    renderDialog();
    fireEvent.click(
      screen.getByRole("button", { name: paymentsMessages.settlement.cancelCharge }),
    );
    expect(screen.getByTestId("settlement-confirm-cancel")).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: paymentsMessages.actions.confirm }),
    );
    await waitFor(() => expect(mocks.cancel.mutateAsync).toHaveBeenCalledTimes(1));
    expect(mocks.cancel.mutateAsync).toHaveBeenCalledWith({
      chargeId: "ch-1",
      force: false,
    });
  });

  it("baixa manual só aparece com capacidade client e flag do servidor", () => {
    renderDialog();
    expect(
      screen.getByRole("button", { name: paymentsMessages.settlement.confirmManual }),
    ).toBeTruthy();
    cleanup();
    Object.assign(mocks.permissions, { canConfirmChargeManual: false });
    renderDialog();
    expect(
      screen.queryByRole("button", { name: paymentsMessages.settlement.confirmManual }),
    ).toBeNull();
  });

  it("estorno exige motivo e mostra aviso de reembolso", async () => {
    mocks.voidPayment.mutateAsync.mockResolvedValue({
      settlement: settlement(),
      refundRequired: true,
      replayed: false,
    });
    renderDialog();
    fireEvent.click(
      screen.getByRole("button", { name: paymentsMessages.void.title }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: paymentsMessages.void.confirm }),
    );
    expect(mocks.voidPayment.mutateAsync).not.toHaveBeenCalled();

    fireEvent.change(
      screen.getByLabelText(paymentsMessages.void.reason),
      { target: { value: "cliente desistiu" } },
    );
    fireEvent.click(
      screen.getByRole("button", { name: paymentsMessages.void.confirm }),
    );
    await waitFor(() =>
      expect(mocks.voidPayment.mutateAsync).toHaveBeenCalledWith({
        paymentId: "p-1",
        reason: "cliente desistiu",
      }),
    );
    await waitFor(() =>
      expect(screen.getByText(paymentsMessages.void.refundWarning)).toBeTruthy(),
    );
  });

  it("Reexibir QR renderiza PixQrPanel inline sem novo Dialog", () => {
    renderDialog();
    fireEvent.click(
      screen.getByRole("button", { name: paymentsMessages.settlement.showQr }),
    );
    expect(screen.getByTestId("pix-qr-panel")).toBeTruthy();
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
  });

  it("registrar pagamento dispara callback sem abrir capture", () => {
    renderDialog();
    fireEvent.click(
      screen.getByRole("button", { name: paymentsMessages.settlement.registerPayment }),
    );
    expect(mocks.onRegisterPayment).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("payment-capture-dialog")).toBeNull();
  });
});
