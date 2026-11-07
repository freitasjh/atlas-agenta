// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { PaymentReceipt } from "@/app/agenda/pagamentos/PaymentReceipt";
import { paymentsMessages } from "@/app/agenda/pagamentos/payments-messages";
import { makeMessagesSpy } from "@/app/agenda/pagamentos/payments-messages.spy";
import type { ReceiptData } from "@/app/agenda/pagamentos/payment-types";

afterEach(cleanup);

const BASE: ReceiptData = {
  customerName: "Ana",
  serviceName: "Corte",
  professionalName: "Bia",
  totalCents: 10000,
  paidCents: 10000,
  tipCents: 0,
  changeCents: null,
  status: "quitado",
  issuedAt: "2026-11-06T12:00:00.000Z",
  lines: [{ method: "dinheiro", amountCents: 10000, tipCents: 0 }],
};

function renderReceipt(overrides: Partial<ReceiptData> = {}) {
  render(
    <PaymentReceipt
      data={{ ...BASE, ...overrides }}
      timeZone="America/Sao_Paulo"
      messages={paymentsMessages}
    />,
  );
}

describe("PaymentReceipt", () => {
  it("separa Pago e Gorjeta em linhas próprias", () => {
    renderReceipt({ tipCents: 500 });
    expect(screen.getByTestId("receipt-paid").textContent?.replace(/\u00a0/g, " ")).toBe("R$ 100,00");
    expect(screen.getByTestId("receipt-tip").textContent?.replace(/\u00a0/g, " ")).toBe("R$ 5,00");
    expect(screen.getByTestId("receipt-status").textContent).toBe("Quitado");
  });

  it("troco só aparece quando calculado", () => {
    renderReceipt();
    expect(screen.queryByTestId("receipt-change")).toBeNull();
    cleanup();
    renderReceipt({ changeCents: 2000 });
    expect(screen.getByTestId("receipt-change").textContent?.replace(/\u00a0/g, " ")).toBe("R$ 20,00");
  });

  it("sem pagamento não mostra 'Pago'", () => {
    renderReceipt({
      paidCents: 0,
      status: "sem_pagamento",
      lines: [],
    });
    expect(screen.queryByTestId("receipt-paid")).toBeNull();
    expect(screen.getByTestId("receipt-status").textContent).toBe("Sem pagamento");
  });

  it("nunca renderiza QR, copia-e-cola, token ou charge_id", () => {
    const { container } = render(
      <PaymentReceipt
        data={{ ...BASE, changeCents: 0 }}
        timeZone="America/Sao_Paulo"
        messages={paymentsMessages}
      />,
    );
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).not.toContain("data:image");
    expect(container.textContent).not.toContain("charge_id");
    expect(container.textContent).not.toContain("pix_copy_paste");
  });

  it("data/hora no fuso do tenant", () => {
    renderReceipt();
    expect(screen.getByText(/06\/11\/2026/)).toBeTruthy();
  });

  it("usa exclusivamente o catálogo (sonda)", () => {
    const m = makeMessagesSpy();
    render(
      <PaymentReceipt
        data={BASE}
        timeZone="America/Sao_Paulo"
        messages={m}
      />,
    );
    expect(screen.getByText(m.receipt.title)).toBeTruthy();
    expect(screen.queryByText(paymentsMessages.receipt.title)).toBeNull();
  });
});
