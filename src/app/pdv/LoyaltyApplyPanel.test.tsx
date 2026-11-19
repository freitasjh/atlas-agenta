// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  validateCoupon: { mutateAsync: vi.fn(), isPending: false },
  validateGift: { mutateAsync: vi.fn(), isPending: false },
  canRegister: true,
}));

vi.mock("@/hooks/usePermissions", () => ({
  usePermissions: () => ({ canRegisterPayments: mocks.canRegister }),
}));

vi.mock("@/hooks/useFidelidade", () => ({
  useValidateCoupon: () => mocks.validateCoupon,
  useValidateGiftCard: () => mocks.validateGift,
}));

import { LoyaltyApplyPanel } from "@/app/pdv/LoyaltyApplyPanel";

function renderPanel(
  totalCents = 10000,
  hasCustomer = true,
  entitled: boolean | null = true,
  appointmentId: string | null = "appt-1",
) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const onApplied = vi.fn();
  render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <LoyaltyApplyPanel
          totalCents={totalCents}
          hasCustomer={hasCustomer}
          entitled={entitled}
          appointmentId={appointmentId}
          onApplied={onApplied}
        />
      </QueryClientProvider>
    </MemoryRouter>,
  );
  return { onApplied };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("LoyaltyApplyPanel", () => {
  it("aplica cupom com discount_cents do servidor (contrato com appointmentId)", async () => {
    mocks.validateCoupon.mutateAsync = vi
      .fn()
      .mockResolvedValue({ valid: true, discount_cents: 1000, reason: null });
    const { onApplied } = renderPanel(10000, true, true, "appt-1");
    fireEvent.change(screen.getByLabelText("Cupom"), { target: { value: "VOLTA10" } });
    fireEvent.click(screen.getByRole("button", { name: /aplicar cupom/i }));
    await waitFor(() =>
      expect(mocks.validateCoupon.mutateAsync).toHaveBeenCalledWith({
        appointmentId: "appt-1",
        code: "VOLTA10",
      }),
    );
    expect(onApplied).toHaveBeenCalledWith(
      expect.objectContaining({ couponCode: "VOLTA10", discountCents: 1000 }),
    );
  });

  it("rejeita cupom inválido", async () => {
    mocks.validateCoupon.mutateAsync = vi.fn().mockResolvedValue({ valid: false, reason: "expired" });
    const { onApplied } = renderPanel(10000, true, true, "appt-1");
    fireEvent.change(screen.getByLabelText("Cupom"), { target: { value: "RUIM" } });
    fireEvent.click(screen.getByRole("button", { name: /aplicar cupom/i }));
    await waitFor(() =>
      expect(mocks.validateCoupon.mutateAsync).toHaveBeenCalledWith({
        appointmentId: "appt-1",
        code: "RUIM",
      }),
    );
    expect(onApplied).not.toHaveBeenCalled();
  });

  it("sem appointmentId, cupom fica pendente para validação no fechamento", async () => {
    mocks.validateCoupon.mutateAsync = vi.fn();
    const { onApplied } = renderPanel(10000, true, true, null);
    fireEvent.change(screen.getByLabelText("Cupom"), { target: { value: "VOLTA10" } });
    fireEvent.click(screen.getByRole("button", { name: /aplicar cupom/i }));
    await waitFor(() =>
      expect(onApplied).toHaveBeenCalledWith(
        expect.objectContaining({ couponCode: "VOLTA10", discountCents: 0 }),
      ),
    );
    // Sem atendimento real não há chamada autoritativa — vale o fechamento.
    expect(mocks.validateCoupon.mutateAsync).not.toHaveBeenCalled();
    expect(screen.getByText(/será validado no fechamento/i)).toBeTruthy();
  });

  it("resgata gift card com saldo parcial", async () => {
    mocks.validateGift.mutateAsync = vi.fn().mockResolvedValue({ valid: true, balance_cents: 3000, reason: null });
    const { onApplied } = renderPanel(10000, true, true, "appt-1");
    fireEvent.change(screen.getByLabelText("Gift card"), { target: { value: "PRESENTE-1" } });
    fireEvent.click(screen.getByRole("button", { name: /resgatar gift card/i }));
    await waitFor(() => expect(mocks.validateGift.mutateAsync).toHaveBeenCalledWith("PRESENTE-1"));
    expect(onApplied).toHaveBeenCalledWith(
      expect.objectContaining({ giftCode: "PRESENTE-1", giftCents: 3000 }),
    );
  });

  it("sem entitlement não renderiza painel", () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    const { container } = render(
      <MemoryRouter>
        <QueryClientProvider client={client}>
          <LoyaltyApplyPanel totalCents={10000} hasCustomer={true} entitled={false} onApplied={() => undefined} />
        </QueryClientProvider>
      </MemoryRouter>,
    );
    expect(container.textContent ?? "").not.toContain("Fidelidade no fechamento");
  });

  it("sem cliente identificado orienta em vez de validar", () => {
    renderPanel(10000, false, true, "appt-1");
    expect(screen.getByText(/finalize a venda identificada/i)).toBeTruthy();
  });
});
