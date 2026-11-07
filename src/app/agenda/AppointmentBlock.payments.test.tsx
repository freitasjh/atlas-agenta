// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AppointmentBlock } from "@/app/agenda/AppointmentBlock";
import { paymentsMessages } from "@/app/agenda/pagamentos/payments-messages";
import type { AppointmentWithRelations } from "@/types/domain";

afterEach(cleanup);

const APPOINTMENT = {
  id: "ap-1",
  customer_id: "c-1",
  professional_id: "pr-1",
  service_id: "s-1",
  combo_id: null,
  starts_at: "2026-11-06T12:00:00.000Z",
  ends_at: "2026-11-06T13:00:00.000Z",
  price_cents: 10000,
  status: "concluido",
  confirmed_at: null,
  confirmed_via: null,
  created_at: "2026-11-01T00:00:00.000Z",
  customers: { name: "Ana", whatsapp_opt_in: false },
  services: { name: "Corte" },
  combos: null,
  professionals: { name: "Bia" },
  commission_cents: null,
} as unknown as AppointmentWithRelations;

function renderBlock(overrides: Record<string, unknown> = {}) {
  const onOpen = vi.fn();
  const onOpenPayment = vi.fn();
  render(
    <AppointmentBlock
      appointment={APPOINTMENT}
      timeZone="America/Sao_Paulo"
      onOpen={onOpen}
      paymentFlag="parcial"
      onOpenPayment={onOpenPayment}
      canRegisterPayments
      messages={paymentsMessages}
      {...overrides}
    />,
  );
  return { onOpen, onOpenPayment };
}

describe("AppointmentBlock — selo e ação de pagamento", () => {
  it("mostra o selo em atendimento concluído pendente", () => {
    renderBlock();
    expect(screen.getByTestId("payment-badge")).toBeTruthy();
  });

  it("não mostra selo quando quitado/unknown/em atendimento", () => {
    renderBlock({ paymentFlag: "quitado" });
    expect(screen.queryByTestId("payment-badge")).toBeNull();
    cleanup();
    renderBlock({ paymentFlag: "unknown" });
    expect(screen.queryByTestId("payment-badge")).toBeNull();
    cleanup();
    renderBlock({ appointment: { ...APPOINTMENT, status: "em_atendimento" }, paymentFlag: "sem_pagamento" });
    expect(screen.queryByTestId("payment-badge")).toBeNull();
  });

  it("ação 'Pagamento' tem nome acessível e não dispara onOpen", () => {
    const { onOpen, onOpenPayment } = renderBlock();
    fireEvent.click(screen.getByRole("button", { name: /Abrir pagamento/ }));
    expect(onOpenPayment).toHaveBeenCalledWith(APPOINTMENT);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("compacto/semana mantém ação acessível com alvo de 44px", () => {
    renderBlock({ compact: true });
    expect(screen.getByTestId("payment-badge")).toBeTruthy();
    const action = screen.getByRole("button", { name: /Abrir pagamento/ });
    expect(action.className).toContain("min-h-[44px]");
    expect(action.className).toContain("min-w-[44px]");
  });

  it("ação de pagamento exige canRegisterPayments", () => {
    renderBlock({ canRegisterPayments: false });
    expect(screen.queryByRole("button", { name: /Abrir pagamento/ })).toBeNull();
  });
});
