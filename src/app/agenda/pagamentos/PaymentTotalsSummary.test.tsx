// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { PaymentTotalsSummary } from "@/app/agenda/pagamentos/PaymentTotalsSummary";
import { paymentsMessages } from "@/app/agenda/pagamentos/payments-messages";
import { makeMessagesSpy } from "@/app/agenda/pagamentos/payments-messages.spy";

afterEach(cleanup);

describe("PaymentTotalsSummary", () => {
  it("mostra total, pago e falta para quitar em BRL", () => {
    render(
      <PaymentTotalsSummary
        totalCents={10000}
        paidCents={4000}
        draftCents={0}
        remainingCents={6000}
        tipCents={0}
        messages={paymentsMessages}
      />,
    );
    expect(screen.getByTestId("payment-total").textContent?.replace(/\u00a0/g, " ")).toBe("R$ 100,00");
    expect(screen.getByTestId("payment-remaining").textContent?.replace(/\u00a0/g, " ")).toBe("R$ 60,00");
    expect(screen.getByTestId("payment-remaining").getAttribute("aria-live")).toBe(
      "polite",
    );
  });

  it("gorjeta só aparece quando maior que zero", () => {
    const { rerender } = render(
      <PaymentTotalsSummary
        totalCents={10000}
        paidCents={0}
        draftCents={10000}
        remainingCents={0}
        tipCents={0}
        messages={paymentsMessages}
      />,
    );
    expect(screen.queryByTestId("payment-tip")).toBeNull();

    rerender(
      <PaymentTotalsSummary
        totalCents={10000}
        paidCents={0}
        draftCents={10000}
        remainingCents={0}
        tipCents={500}
        messages={paymentsMessages}
      />,
    );
    expect(screen.getByTestId("payment-tip").textContent?.replace(/\u00a0/g, " ")).toBe("R$ 5,00");
  });

  it("expõe um grupo rotulado", () => {
    render(
      <PaymentTotalsSummary
        totalCents={0}
        paidCents={0}
        draftCents={0}
        remainingCents={0}
        tipCents={0}
        messages={paymentsMessages}
      />,
    );
    expect(screen.getByRole("group")).toBeTruthy();
  });

  it("usa exclusivamente o catálogo (sonda)", () => {
    const m = makeMessagesSpy();
    render(
      <PaymentTotalsSummary
        totalCents={10000}
        paidCents={0}
        draftCents={0}
        remainingCents={10000}
        tipCents={0}
        messages={m}
      />,
    );
    expect(screen.getByText(m.dialog.total)).toBeTruthy();
    expect(screen.getByText(m.dialog.remaining)).toBeTruthy();
    expect(screen.queryByText(paymentsMessages.dialog.total)).toBeNull();
  });
});
