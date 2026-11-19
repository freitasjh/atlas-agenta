// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  entitlements: { fidelidade: true } as unknown,
  program: null as unknown,
  accounts: [] as Array<Record<string, unknown>>,
  transactions: [] as Array<Record<string, unknown>>,
  loading: false,
}));

vi.mock("@/hooks/usePlanEntitlements", () => ({
  usePlanEntitlements: () => mocks.entitlements,
}));

vi.mock("@/hooks/useFidelidade", () => ({
  useLoyaltyProgram: () => ({ data: mocks.program, isLoading: false }),
  useLoyaltyAccounts: () => ({ data: mocks.accounts, isLoading: mocks.loading }),
  useLoyaltyTransactions: () => ({ data: mocks.transactions, isLoading: false }),
}));

import { FidelidadeTab } from "@/app/fidelidade/FidelidadeTab";

function renderTab(customerId = "c1") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <FidelidadeTab customerId={customerId} />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

afterEach(cleanup);

describe("FidelidadeTab", () => {
  it("exibe saldo e extrato do cliente", () => {
    mocks.accounts = [{ id: "a1", tenant_id: "t1", customer_id: "c1", balance_points: 80, lifetime_points: 150 }];
    mocks.transactions = [
      { id: "tx1", tenant_id: "t1", account_id: "a1", appointment_id: null, type: "credit", points: 80, reason: "Atendimento", expires_at: null, created_at: "2026-01-01T10:00:00.000Z" },
    ];
    renderTab();
    expect(screen.getAllByText("80").length).toBeGreaterThan(0);
    expect(screen.getByText("Crédito")).toBeTruthy();
  });

  it("sem cartão mostra estado vazio", () => {
    mocks.accounts = [];
    mocks.transactions = [];
    renderTab("sem-cartao");
    expect(screen.getByText(/cartões aparecem após o primeiro crédito/i)).toBeTruthy();
  });
});
