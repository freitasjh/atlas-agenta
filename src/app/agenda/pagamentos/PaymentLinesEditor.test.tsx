// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PaymentLinesEditor } from "@/app/agenda/pagamentos/PaymentLinesEditor";
import { paymentsMessages } from "@/app/agenda/pagamentos/payments-messages";
import { makeMessagesSpy } from "@/app/agenda/pagamentos/payments-messages.spy";
import type { PaymentLineDraft } from "@/app/agenda/pagamentos/payment-types";

afterEach(cleanup);

const LINES: PaymentLineDraft[] = [
  {
    key: "k1",
    method: "dinheiro",
    amountCents: 6000,
    tipCents: 0,
    cashReceivedCents: 0,
    cardConfirmed: false,
  },
];

function renderEditor(overrides: Partial<ComponentProps<typeof PaymentLinesEditor>> = {}) {
  const onAdd = vi.fn();
  const onUpdate = vi.fn();
  const onRemove = vi.fn();
  render(
    <PaymentLinesEditor
      lines={[]}
      disabled={false}
      onAdd={onAdd}
      onUpdate={onUpdate}
      onRemove={onRemove}
      messages={paymentsMessages}
      {...overrides}
    />,
  );
  return { onAdd, onUpdate, onRemove };
}

describe("PaymentLinesEditor", () => {
  it("mostra os 5 chips e o estado vazio", () => {
    renderEditor();
    for (const method of [
      "dinheiro",
      "cartao_credito",
      "cartao_debito",
      "pix_sistema",
      "pix_maquininha",
    ]) {
      expect(screen.getByTestId(`payment-method-chip-${method}`)).toBeTruthy();
    }
    expect(screen.getByText(paymentsMessages.dialog.emptyLines)).toBeTruthy();
    expect(screen.queryByText(paymentsMessages.actions.registerLater)).toBeNull();
  });

  it("não duplica pix_sistema e explica o motivo", () => {
    renderEditor({
      lines: [...LINES, { ...LINES[0], key: "k2", method: "pix_sistema" }],
    });
    const pixChip = screen.getByTestId("payment-method-chip-pix_sistema") as HTMLButtonElement;
    expect(pixChip.disabled).toBe(true);
    expect(screen.getByText(paymentsMessages.error.pixUsed)).toBeTruthy();
  });

  it("'Adicionar forma' escolhe o próximo método livre", () => {
    const { onAdd } = renderEditor({ lines: LINES });
    fireEvent.click(screen.getByRole("button", { name: paymentsMessages.actions.addMethod }));
    expect(onAdd).toHaveBeenCalledWith("cartao_credito");
  });

  it("respeita o motivo externo (Asaas ausente)", () => {
    renderEditor({
      methodDisabledReasons: { pix_sistema: paymentsMessages.error.noAsaas },
    });
    expect(
      (screen.getByTestId("payment-method-chip-pix_sistema") as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(screen.getByText(paymentsMessages.error.noAsaas)).toBeTruthy();
  });

  it("usa exclusivamente o catálogo (sonda)", () => {
    const m = makeMessagesSpy();
    renderEditor({ messages: m });
    expect(screen.getByText(m.dialog.emptyLines)).toBeTruthy();
    expect(
      screen.getByRole("button", { name: m.actions.addMethod }),
    ).toBeTruthy();
    expect(screen.queryByText(paymentsMessages.dialog.emptyLines)).toBeNull();
  });
});
