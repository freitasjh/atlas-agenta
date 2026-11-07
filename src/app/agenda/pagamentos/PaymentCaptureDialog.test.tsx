// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PaymentCaptureDialog } from "@/app/agenda/pagamentos/PaymentCaptureDialog";
import { paymentsMessages } from "@/app/agenda/pagamentos/payments-messages";
import { PaymentApiError } from "@/lib/payment-errors";
import type { AppointmentSettlement } from "@/types/payments";

const mocks = vi.hoisted(() => ({
  settlement: {
    data: null as unknown,
    isError: false,
    refetch: vi.fn(),
  },
  registerMutate: vi.fn(),
  createChargeMutate: vi.fn(),
  asaas: { data: { active: true } as unknown, isLoading: false },
  onOpenChange: vi.fn(),
  onCompleted: vi.fn(),
}));

vi.mock("@/hooks/useAppointmentPayments", () => ({
  useAppointmentSettlement: () => mocks.settlement,
  useRegisterAppointmentPayments: () => ({ mutateAsync: mocks.registerMutate }),
}));
vi.mock("@/hooks/useCharges", () => ({
  useCreateCharge: () => ({ mutateAsync: mocks.createChargeMutate }),
}));
vi.mock("@/hooks/useAsaasConfig", () => ({ useAsaasConfig: () => mocks.asaas }));
vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ tenant: { timezone: "America/Sao_Paulo" } }),
}));
vi.mock(["son", "ner"].join(""), () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

const APPOINTMENT = {
  id: "ap-1",
  customerName: "Ana",
  serviceName: "Corte",
  professionalName: "Bia",
  totalCents: 10000,
  status: "em_atendimento" as const,
};

function settlement(overrides: Record<string, unknown> = {}): AppointmentSettlement {
  return {
    appointment: {
      id: "ap-1",
      status: "em_atendimento",
      starts_at: "2026-11-06T12:00:00.000Z",
      customer_name: "Ana",
      service_name: "Corte",
      professional_name: "Bia",
      total_cents: 10000,
    },
    payments: [],
    pending_charges: [],
    stale_charges: [],
    total_paid_cents: 0,
    tip_cents: 0,
    reserved_cents: 0,
    remaining_cents: 10000,
    payment_status: "sem_pagamento",
    permissions: {
      can_register: true,
      can_cancel_charge: true,
      can_confirm_manual: false,
      can_void: true,
      can_view_qr: true,
      can_reissue_pix: false,
    },
    ...overrides,
  } as unknown as AppointmentSettlement;
}

function renderDialog(props: Partial<ComponentProps<typeof PaymentCaptureDialog>> = {}) {
  render(
    <PaymentCaptureDialog
      open
      mode="close"
      appointment={APPOINTMENT}
      onOpenChange={mocks.onOpenChange}
      onCompleted={mocks.onCompleted}
      {...props}
    />,
  );
}

async function openEditor() {
  renderDialog();
  await waitFor(() =>
    expect(screen.getByTestId("payment-lines-editor")).toBeTruthy(),
  );
}

beforeEach(() => {
  mocks.settlement.data = settlement();
  mocks.settlement.isError = false;
  mocks.settlement.refetch.mockReset();
  mocks.registerMutate.mockReset();
  mocks.createChargeMutate.mockReset();
  mocks.onOpenChange.mockReset();
  mocks.onCompleted.mockReset();
  mocks.asaas.data = { active: true };
  mocks.asaas.isLoading = false;
});

afterEach(cleanup);

describe("PaymentCaptureDialog", () => {
  it("admin/operador vê um único Dialog e o resumo", async () => {
    await openEditor();
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    expect(screen.getByTestId("payment-capture-dialog")).toBeTruthy();
    expect(
      screen.getByTestId("payment-remaining").textContent?.replace(/\u00a0/g, " "),
    ).toContain("R$ 100,00");
  });

  it("parcial exige confirmação explícita e 'Voltar' não persiste", async () => {
    await openEditor();
    fireEvent.click(
      screen.getByRole("button", { name: "Adicionar Dinheiro" }),
    );
    const amount = screen.getByLabelText(paymentsMessages.fields.amount);
    fireEvent.change(amount, { target: { value: "40,00" } });

    fireEvent.click(screen.getByRole("button", { name: paymentsMessages.actions.confirm }));
    expect(screen.getByTestId("payment-confirm-partial")).toBeTruthy();
    expect(mocks.registerMutate).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: paymentsMessages.actions.back }));
    expect(screen.queryByTestId("payment-confirm-partial")).toBeNull();
    expect(mocks.registerMutate).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: paymentsMessages.actions.confirm }));
    fireEvent.click(
      screen.getByRole("button", { name: paymentsMessages.partial.confirm }),
    );
    await waitFor(() => expect(mocks.registerMutate).toHaveBeenCalledTimes(1));
    expect(mocks.registerMutate.mock.calls[0]?.[0]).toMatchObject({
      appointmentId: "ap-1",
      closeAppointment: true,
      payments: [{ method: "dinheiro", amountCents: 4000, tipCents: 0 }],
    });
  });

  it("'Registrar depois' envia payments vazio e close_appointment true", async () => {
    await openEditor();
    fireEvent.click(
      screen.getByRole("button", { name: paymentsMessages.actions.registerLater }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: paymentsMessages.actions.confirm }),
    );
    await waitFor(() => expect(mocks.registerMutate).toHaveBeenCalledTimes(1));
    expect(mocks.registerMutate.mock.calls[0]?.[0]).toMatchObject({
      closeAppointment: true,
      payments: [],
    });
  });

  it("modalidade register exige ao menos uma linha e envia close_appointment false", async () => {
    renderDialog({ mode: "register" });
    await waitFor(() =>
      expect(screen.getByTestId("payment-lines-editor")).toBeTruthy(),
    );
    fireEvent.click(screen.getByRole("button", { name: paymentsMessages.actions.confirm }));
    expect(mocks.registerMutate).not.toHaveBeenCalled();

    fireEvent.click(
      screen.getByRole("button", { name: "Adicionar Dinheiro" }),
    );
    fireEvent.click(screen.getByRole("button", { name: paymentsMessages.actions.confirm }));
    await waitFor(() => expect(mocks.registerMutate).toHaveBeenCalledTimes(1));
    expect(mocks.registerMutate.mock.calls[0]?.[0]).toMatchObject({
      closeAppointment: false,
    });
    // "Registrar depois" não existe no modo register.
    expect(
      screen.queryByRole("button", { name: paymentsMessages.actions.registerLater }),
    ).toBeNull();
  });

  it("GATEWAY_ERROR mantém o diálogo e mostra role=alert", async () => {
    mocks.registerMutate.mockRejectedValue(
      new PaymentApiError("GATEWAY_ERROR", {
        status: 422,
        settlement: settlement(),
        pixAmountCents: 3000,
      }),
    );
    await openEditor();
    fireEvent.click(
      screen.getByRole("button", { name: "Adicionar PIX do sistema" }),
    );
    fireEvent.click(screen.getByRole("button", { name: paymentsMessages.actions.confirm }));

    await waitFor(() =>
      expect(screen.getByText(paymentsMessages.error.gateway)).toBeTruthy(),
    );
    expect(screen.getByTestId("payment-capture-dialog")).toBeTruthy();
    expect(screen.getByRole("alert")).toBeTruthy();
  });

  it("gateway_error com atendimento já concluído não reenvia o lote e fecha", async () => {
    const concluded = settlement({
      appointment: { ...settlement().appointment, status: "concluido" },
    });
    mocks.registerMutate.mockRejectedValue(
      new PaymentApiError("GATEWAY_ERROR", {
        status: 422,
        settlement: concluded,
        pixAmountCents: 10000,
      }),
    );
    mocks.settlement.refetch.mockResolvedValue({ data: concluded });

    await openEditor();
    fireEvent.click(
      screen.getByRole("button", { name: "Adicionar PIX do sistema" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: paymentsMessages.actions.confirm }),
    );
    await waitFor(() =>
      expect(screen.getByText(paymentsMessages.error.gateway)).toBeTruthy(),
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: paymentsMessages.actions.finishWithoutPayment,
      }),
    );

    await waitFor(() => expect(mocks.onOpenChange).toHaveBeenCalledWith(false));
    // Nenhum POST novo: o servidor já concluiu (replay daria 409).
    expect(mocks.registerMutate).toHaveBeenCalledTimes(1);
    expect(mocks.settlement.refetch).toHaveBeenCalledTimes(1);
  });

  it("gateway_error com atendimento em andamento ainda reenvia sem PIX", async () => {
    mocks.registerMutate
      .mockRejectedValueOnce(
        new PaymentApiError("GATEWAY_ERROR", {
          status: 422,
          settlement: settlement(),
          pixAmountCents: 10000,
        }),
      )
      .mockResolvedValueOnce({
        settlement: settlement({ payment_status: "sem_pagamento" }),
        charge: null,
        replayed: false,
      });

    await openEditor();
    fireEvent.click(
      screen.getByRole("button", { name: "Adicionar PIX do sistema" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: paymentsMessages.actions.confirm }),
    );
    await waitFor(() =>
      expect(screen.getByText(paymentsMessages.error.gateway)).toBeTruthy(),
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: paymentsMessages.actions.finishWithoutPayment,
      }),
    );

    await waitFor(() => expect(mocks.registerMutate).toHaveBeenCalledTimes(2));
    expect(mocks.registerMutate.mock.calls[1]?.[0]).toMatchObject({
      closeAppointment: true,
      payments: [],
    });
  });

  it("retry com atendimento concluído chama só create-charge", async () => {    const concluded = settlement({
      appointment: { ...settlement().appointment, status: "concluido" },
      payments: [
        {
          id: "p-1",
          method: "dinheiro",
          amount_cents: 7000,
          tip_cents: 0,
          source: "manual",
          received_at: "2026-11-06T12:30:00.000Z",
          voided_at: null,
          void_reason: null,
        },
      ],
      total_paid_cents: 7000,
      remaining_cents: 3000,
      payment_status: "parcial",
    });
    mocks.registerMutate.mockRejectedValue(
      new PaymentApiError("GATEWAY_ERROR", {
        status: 422,
        settlement: concluded,
        pixAmountCents: 3000,
      }),
    );
    mocks.settlement.refetch.mockResolvedValue({ data: concluded });
    mocks.createChargeMutate.mockResolvedValue({
      id: "ch-9",
      amount_cents: 3000,
      pix_qr_code: "qr",
      pix_copy_paste: "code",
      expires_at: null,
      reused: false,
    });

    await openEditor();
    fireEvent.click(
      screen.getByRole("button", { name: "Adicionar PIX do sistema" }),
    );
    fireEvent.click(screen.getByRole("button", { name: paymentsMessages.actions.confirm }));
    await waitFor(() =>
      expect(screen.getByText(paymentsMessages.error.gateway)).toBeTruthy(),
    );

    fireEvent.click(screen.getByRole("button", { name: paymentsMessages.actions.retry }));
    await waitFor(() => expect(mocks.createChargeMutate).toHaveBeenCalledTimes(1));
    expect(mocks.registerMutate).toHaveBeenCalledTimes(1);
    expect(mocks.createChargeMutate.mock.calls[0]?.[0]).toMatchObject({
      appointmentId: "ap-1",
      amountCents: 3000,
    });
  });

  it("IDEMPOTENCY_CONFLICT regenera a chave e pede revisão", async () => {
    mocks.registerMutate.mockRejectedValueOnce(
      new PaymentApiError("IDEMPOTENCY_CONFLICT", { status: 409 }),
    );
    await openEditor();
    fireEvent.click(
      screen.getByRole("button", { name: "Adicionar Dinheiro" }),
    );
    fireEvent.click(screen.getByRole("button", { name: paymentsMessages.actions.confirm }));
    await waitFor(() =>
      expect(screen.getByTestId("payment-inline-error").textContent).toBe(
        paymentsMessages.error.idempotency,
      ),
    );

    mocks.registerMutate.mockResolvedValueOnce({
      settlement: settlement({
        total_paid_cents: 10000,
        remaining_cents: 0,
        payment_status: "quitado",
        payments: [
          {
            id: "p-1",
            method: "dinheiro",
            amount_cents: 10000,
            tip_cents: 0,
            source: "manual",
            received_at: "2026-11-06T12:30:00.000Z",
            voided_at: null,
            void_reason: null,
          },
        ],
      }),
      charge: null,
      replayed: false,
    });
    fireEvent.click(screen.getByRole("button", { name: paymentsMessages.actions.confirm }));
    await waitFor(() => expect(mocks.registerMutate).toHaveBeenCalledTimes(2));
    const firstKey = mocks.registerMutate.mock.calls[0]?.[0].idempotencyKey;
    const secondKey = mocks.registerMutate.mock.calls[1]?.[0].idempotencyKey;
    expect(firstKey).toBeTruthy();
    expect(secondKey).toBeTruthy();
    expect(secondKey).not.toBe(firstKey);
  });

  it("sucesso mostra comprovante e 'Fechar' conclui", async () => {
    const concluded = settlement({
      total_paid_cents: 10000,
      remaining_cents: 0,
      payment_status: "quitado",
      payments: [
        {
          id: "p-1",
          method: "dinheiro",
          amount_cents: 10000,
          tip_cents: 0,
          source: "manual",
          received_at: "2026-11-06T12:30:00.000Z",
          voided_at: null,
          void_reason: null,
        },
      ],
    });
    mocks.registerMutate.mockResolvedValue({
      settlement: concluded,
      charge: null,
      replayed: false,
    });
    await openEditor();
    fireEvent.click(
      screen.getByRole("button", { name: "Adicionar Dinheiro" }),
    );
    fireEvent.click(screen.getByRole("button", { name: paymentsMessages.actions.confirm }));
    await waitFor(() => expect(screen.getByTestId("payment-receipt")).toBeTruthy());

    fireEvent.click(
      screen.getAllByRole("button", { name: paymentsMessages.actions.close })[0],
    );
    expect(mocks.onCompleted).toHaveBeenCalledWith(concluded);
    expect(mocks.onOpenChange).toHaveBeenCalledWith(false);
  });

  it("retry do settlement volta para edição quando os dados chegam", async () => {
    mocks.settlement.data = null;
    mocks.settlement.isError = true;
    mocks.settlement.refetch.mockResolvedValue({ data: settlement() });

    renderDialog();
    await waitFor(() =>
      expect(screen.getByRole("alert")).toBeTruthy(),
    );
    fireEvent.click(
      screen.getByRole("button", { name: paymentsMessages.actions.retry }),
    );

    await waitFor(() =>
      expect(screen.getByTestId("payment-lines-editor")).toBeTruthy(),
    );
  });

  it("confirm_partial desabilita a edição do rascunho", async () => {
    await openEditor();
    fireEvent.click(
      screen.getByRole("button", { name: "Adicionar Dinheiro" }),
    );
    fireEvent.change(screen.getByLabelText(paymentsMessages.fields.amount), {
      target: { value: "40,00" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: paymentsMessages.actions.confirm }),
    );

    expect(screen.getByTestId("payment-confirm-partial")).toBeTruthy();
    expect(
      (screen.getByLabelText(paymentsMessages.fields.amount) as HTMLInputElement)
        .disabled,
    ).toBe(true);
  });

  it("ESC e cancelar não descartam rascunho em silêncio", async () => {
    await openEditor();
    fireEvent.click(
      screen.getByRole("button", { name: "Adicionar Dinheiro" }),
    );
    fireEvent.change(screen.getByLabelText(paymentsMessages.fields.amount), {
      target: { value: "40,00" },
    });

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() =>
      expect(screen.getByTestId("payment-confirm-discard")).toBeTruthy(),
    );
    expect(mocks.onOpenChange).not.toHaveBeenCalledWith(false);

    fireEvent.click(
      screen.getByRole("button", { name: paymentsMessages.actions.back }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: paymentsMessages.actions.cancel }),
    );
    expect(screen.getByTestId("payment-confirm-discard")).toBeTruthy();
    expect(mocks.onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it("PIX do sistema fica desabilitado sem Asaas", async () => {
    mocks.asaas.data = null;
    await openEditor();
    const chip = screen.getByTestId("payment-method-chip-pix_sistema") as HTMLButtonElement;
    expect(chip.disabled).toBe(true);
    expect(screen.getByText(paymentsMessages.error.noAsaas)).toBeTruthy();
  });
});
