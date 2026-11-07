// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { PaymentStatusBadge } from "@/app/agenda/pagamentos/PaymentStatusBadge";
import { paymentsMessages } from "@/app/agenda/pagamentos/payments-messages";
import { makeMessagesSpy } from "@/app/agenda/pagamentos/payments-messages.spy";

afterEach(cleanup);

describe("PaymentStatusBadge", () => {
  it("renderiza texto e aria-label do status pendente", () => {
    render(<PaymentStatusBadge status="parcial" messages={paymentsMessages} />);
    const badge = screen.getByTestId("payment-badge");
    expect(badge.textContent).toContain("Pagamento pendente");
    expect(badge.getAttribute("aria-label")).toBe(
      "Pagamento pendente (Parcial)",
    );
  });

  it("aguardando PIX acrescenta o sufixo textual", () => {
    render(
      <PaymentStatusBadge status="aguardando_pix" messages={paymentsMessages} />,
    );
    expect(screen.getByTestId("payment-badge").textContent).toContain(
      "Aguardando PIX",
    );
  });

  it("quitado não renderiza nada", () => {
    const { container } = render(
      <PaymentStatusBadge status="quitado" messages={paymentsMessages} />,
    );
    expect(container.innerHTML).toBe("");
  });

  it("usa exclusivamente o catálogo (sonda)", () => {
    const m = makeMessagesSpy();
    render(<PaymentStatusBadge status="sem_pagamento" messages={m} />);
    expect(screen.getByTestId("payment-badge").textContent).toContain(
      m.badge.pending,
    );
    expect(screen.queryByText("Pagamento pendente")).toBeNull();
  });
});
