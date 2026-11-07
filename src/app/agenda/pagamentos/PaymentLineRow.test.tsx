// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PaymentLineRow } from "@/app/agenda/pagamentos/PaymentLineRow";
import { paymentsMessages } from "@/app/agenda/pagamentos/payments-messages";
import { makeMessagesSpy } from "@/app/agenda/pagamentos/payments-messages.spy";
import type { PaymentLineDraft } from "@/app/agenda/pagamentos/payment-types";

afterEach(cleanup);

function cashLine(overrides: Partial<PaymentLineDraft> = {}): PaymentLineDraft {
  return {
    key: "k1",
    method: "dinheiro",
    amountCents: 10000,
    tipCents: 0,
    cashReceivedCents: 0,
    cardConfirmed: false,
    ...overrides,
  };
}

function renderRow(line: PaymentLineDraft, overrides: Partial<ComponentProps<typeof PaymentLineRow>> = {}) {
  const onChange = vi.fn();
  const onRemove = vi.fn();
  render(
    <PaymentLineRow
      line={line}
      remainingCents={10000}
      disabled={false}
      onChange={onChange}
      onRemove={onRemove}
      messages={paymentsMessages}
      {...overrides}
    />,
  );
  return { onChange, onRemove };
}

describe("PaymentLineRow", () => {
  it("dinheiro mostra Valor recebido e Troco calculado", () => {
    renderRow(cashLine({ cashReceivedCents: 12000 }));
    expect(screen.getByLabelText(paymentsMessages.fields.cashReceived)).toBeTruthy();
    expect(screen.getByTestId("payment-line-k1-change").textContent?.replace(/\u00a0/g, " ")).toBe("R$ 20,00");
    expect(screen.getByLabelText(paymentsMessages.fields.amount)).toBeTruthy();
    expect(screen.getByLabelText(paymentsMessages.fields.tip)).toBeTruthy();
  });

  it("recebido menor que o valor exibe role=alert e marca inválido", () => {
    renderRow(cashLine({ cashReceivedCents: 9000 }), { showValidation: true });
    const alert = screen.getAllByRole("alert")[0];
    expect(alert.textContent).toBe(paymentsMessages.error.cashShort);
    expect(
      screen.getByLabelText(paymentsMessages.fields.cashReceived).getAttribute(
        "data-invalid",
      ),
    ).toBe("true");
  });

  it("cartão não mostra troco e exige confirmação", () => {
    renderRow(cashLine({ method: "cartao_debito" }), { showValidation: true });
    expect(screen.queryByText(paymentsMessages.fields.change)).toBeNull();
    expect(screen.getByRole("checkbox")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toBe(
      paymentsMessages.error.cardNotConfirmed,
    );
  });

  it("remover só aparece quando não está desabilitado", () => {
    const { rerender } = render(
      <PaymentLineRow
        line={cashLine()}
        remainingCents={10000}
        disabled={false}
        onChange={vi.fn()}
        onRemove={vi.fn()}
        messages={paymentsMessages}
        showValidation={false}
      />,
    );
    expect(screen.getByRole("button", { name: paymentsMessages.actions.removeLine })).toBeTruthy();

    rerender(
      <PaymentLineRow
        line={cashLine()}
        remainingCents={10000}
        disabled
        onChange={vi.fn()}
        onRemove={vi.fn()}
        messages={paymentsMessages}
      />,
    );
    expect(screen.queryByRole("button", { name: paymentsMessages.actions.removeLine })).toBeNull();
  });

  it("emite onChange em centavos e não usa type=number", () => {
    const { onChange } = renderRow(cashLine());
    fireEvent.change(screen.getByLabelText(paymentsMessages.fields.amount), {
      target: { value: "45,00" },
    });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0]?.[0].amountCents).toBe(4500);
    expect(document.querySelector("input[type=number]")).toBeNull();
  });

  it("usa exclusivamente o catálogo (sonda)", () => {
    const m = makeMessagesSpy();
    renderRow(cashLine(), { messages: m });
    expect(screen.getByText(m.method.dinheiro)).toBeTruthy();
    expect(screen.queryByText(paymentsMessages.method.dinheiro)).toBeNull();
  });

  it("erro de dinheiro liga aria-invalid/aria-describedby ao campo", () => {
    renderRow(cashLine({ cashReceivedCents: 9000 }), { showValidation: true });
    const cash = screen.getByLabelText(paymentsMessages.fields.cashReceived);
    const describedBy = cash.getAttribute("aria-describedby");
    expect(cash.getAttribute("aria-invalid")).toBe("true");
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy as string)?.textContent).toBe(
      paymentsMessages.error.cashShort,
    );
  });
});
