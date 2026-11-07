// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PaymentMethodChip } from "@/app/agenda/pagamentos/PaymentMethodChip";
import { paymentsMessages } from "@/app/agenda/pagamentos/payments-messages";
import { makeMessagesSpy } from "@/app/agenda/pagamentos/payments-messages.spy";

afterEach(cleanup);

describe("PaymentMethodChip", () => {
  it("é um botão de ação com nome acessível e sem aria-pressed", () => {
    const onSelect = vi.fn();
    render(
      <PaymentMethodChip
        method="dinheiro"
        onSelect={onSelect}
        messages={paymentsMessages}
      />,
    );
    const chip = screen.getByRole("button", { name: "Adicionar Dinheiro" });
    expect(chip.getAttribute("aria-pressed")).toBeNull();
    expect(chip.className).toContain("min-h-[44px]");
    fireEvent.click(chip);
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith("dinheiro");
  });

  it("desabilitado descreve o motivo", () => {
    render(
      <PaymentMethodChip
        method="pix_sistema"
        disabled
        disabledReason="Este atendimento já tem um PIX pendente"
        onSelect={vi.fn()}
        messages={paymentsMessages}
      />,
    );
    const chip = screen.getByRole("button", {
      name: "Adicionar PIX do sistema",
    }) as HTMLButtonElement;
    expect(chip.disabled).toBe(true);
    expect(chip.getAttribute("aria-describedby")).toBeTruthy();
    expect(
      screen.getByText("Este atendimento já tem um PIX pendente"),
    ).toBeTruthy();
  });

  it("usa exclusivamente o catálogo (sonda)", () => {
    const m = makeMessagesSpy();
    render(
      <PaymentMethodChip
        method="dinheiro"
        onSelect={vi.fn()}
        messages={m}
      />,
    );
    expect(screen.getByText(m.method.dinheiro)).toBeTruthy();
    expect(screen.queryByText(paymentsMessages.method.dinheiro)).toBeNull();
  });
});
