// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SettlementPaymentRow } from "@/app/agenda/pagamentos/SettlementPaymentRow";
import { paymentsMessages } from "@/app/agenda/pagamentos/payments-messages";
import type { PaymentsMessages } from "@/app/agenda/pagamentos/payments-messages";
import { makeMessagesSpy } from "@/app/agenda/pagamentos/payments-messages.spy";
import type { SettlementPayment } from "@/types/payments";

afterEach(cleanup);

const PAYMENT: SettlementPayment = {
  id: "p-1",
  method: "cartao_debito",
  amount_cents: 4000,
  tip_cents: 500,
  source: "asaas",
  received_at: "2026-11-06T12:00:00.000Z",
  voided_at: null,
  void_reason: null,
};

function renderRow(
  payment: SettlementPayment = PAYMENT,
  canVoid = true,
  messages: PaymentsMessages = paymentsMessages,
) {
  const onVoidRequest = vi.fn();
  render(
    <SettlementPaymentRow
      payment={payment}
      canVoid={canVoid}
      onVoidRequest={onVoidRequest}
      messages={messages}
      timeZone="America/Sao_Paulo"
    />,
  );
  return { onVoidRequest };
}

describe("SettlementPaymentRow", () => {
  it("mostra método, valor, gorjeta, origem e data", () => {
    renderRow();
    expect(screen.getByText("Cartão de débito")).toBeTruthy();
    expect(screen.getByText("R$ 40,00")).toBeTruthy();
    expect(screen.getByText(/Gorjeta R\$ 5,00/)).toBeTruthy();
    expect(screen.getByText("PIX")).toBeTruthy();
  });

  it("estornada sem motivo mostra apenas 'Estornada'", () => {
    renderRow(
      { ...PAYMENT, voided_at: "2026-11-06T13:00:00.000Z", void_reason: null },
      false,
    );
    expect(screen.getByText(/Estornada/)).toBeTruthy();
    expect(screen.queryByText(/Motivo:/)).toBeNull();
  });

  it("estornada com motivo mostra o motivo (recorte admin)", () => {
    renderRow({
      ...PAYMENT,
      voided_at: "2026-11-06T13:00:00.000Z",
      void_reason: "cliente desistiu",
    });
    expect(screen.getByText(/cliente desistiu/)).toBeTruthy();
  });

  it("'Estornar' só existe com canVoid e recebimento ativo", () => {
    const { onVoidRequest } = renderRow();
    fireEvent.click(
      screen.getByRole("button", { name: paymentsMessages.void.title }),
    );
    expect(onVoidRequest).toHaveBeenCalledWith(PAYMENT);
    cleanup();
    renderRow(PAYMENT, false);
    expect(
      screen.queryByRole("button", { name: paymentsMessages.void.title }),
    ).toBeNull();
  });

  it("usa exclusivamente o catálogo (sonda)", () => {
    const m = makeMessagesSpy();
    renderRow(PAYMENT, true, m);
    expect(screen.getByText(m.method.cartao_debito)).toBeTruthy();
    expect(screen.queryByText(paymentsMessages.method.cartao_debito)).toBeNull();
  });
});
