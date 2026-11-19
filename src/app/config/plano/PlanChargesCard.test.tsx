// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PlanChargesCard } from "@/app/config/plano/PlanChargesCard";
import type { SubscriptionCharge } from "@/hooks/useSubscriptionCharges";

const mocks = vi.hoisted(() => ({
  charges: [] as SubscriptionCharge[],
  isLoading: false,
  isError: false,
  refetch: vi.fn(),
  tenant: { timezone: "America/Sao_Paulo" } as unknown,
}));

vi.mock("@/hooks/useSubscriptionCharges", () => ({
  useSubscriptionCharges: () => ({
    data: mocks.charges,
    isLoading: mocks.isLoading,
    isError: mocks.isError,
    refetch: mocks.refetch,
  }),
}));

vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ tenant: mocks.tenant }),
}));

afterEach(() => {
  cleanup();
  mocks.charges = [];
  mocks.isLoading = false;
  mocks.isError = false;
});

function renderCard() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <PlanChargesCard />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

function charge(
  overrides: Partial<SubscriptionCharge> & { id: string },
): SubscriptionCharge {
  return {
    tenant_id: "tenant-1",
    asaas_payment_id: null,
    status: "pago",
    amount_cents: 14900,
    plan: "premium",
    billing_period: "monthly",
    pix_qr_code: null,
    pix_copy_paste: null,
    expires_at: null,
    paid_at: "2026-01-05T12:00:00.000Z",
    created_at: "2026-01-01T12:00:00.000Z",
    ...overrides,
  };
}

describe("PlanChargesCard (RF-35)", () => {
  it("whenNoCharges_thenShowsEmptyStates", () => {
    renderCard();
    expect(screen.getByText("Fatura atual")).toBeDefined();
    expect(screen.getByText("Histórico de faturas")).toBeDefined();
    expect(
      screen.getAllByText(/Nenhuma fatura encontrada|Ainda não há cobranças/).length,
    ).toBeGreaterThan(0);
  });

  it("whenOpenCharge_thenHighlightsCurrentInvoice", () => {
    mocks.charges = [
      charge({ id: "open-1", status: "pendente", paid_at: null, expires_at: "2030-01-10T12:00:00.000Z" }),
      charge({ id: "paid-1", status: "pago" }),
    ];
    renderCard();
    expect(screen.getAllByText("Pendente").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Paga").length).toBeGreaterThan(0);
  });

  it("whenLoading_thenShowsBusyState", () => {
    mocks.isLoading = true;
    renderCard();
    expect(screen.getByLabelText(/Carregando plano/)).toBeDefined();
  });

  it("whenError_thenShowsRetry", () => {
    mocks.isError = true;
    renderCard();
    expect(
      screen.getByText(/Não foi possível carregar as faturas/),
    ).toBeDefined();
    expect(
      screen.getByRole("button", { name: /Tentar novamente/ }),
    ).toBeDefined();
  });
});
