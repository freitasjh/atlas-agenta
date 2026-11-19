// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

const { creditsMock, entitlementsMock } = vi.hoisted(() => ({
  creditsMock: { data: [] as unknown[], isLoading: false, isError: false, refetch: vi.fn() },
  entitlementsMock: { value: null as unknown },
}));

vi.mock("@/hooks/usePackageCredits", () => ({
  usePackageBalance: () => ({ data: [], isLoading: false }),
  useSellPackage: () => ({ mutateAsync: vi.fn(), isPending: false }),
  usePackageCredits: () => creditsMock,
}));

vi.mock("@/hooks/usePlanEntitlements", () => ({
  usePlanEntitlements: () => entitlementsMock.value,
}));

vi.mock("@/hooks/useCustomers", () => ({
  useCustomers: () => ({ data: [], isLoading: false }),
}));

vi.mock("@/hooks/useServices", () => ({
  useServices: () => ({ data: [], isLoading: false }),
}));

vi.mock("@/hooks/usePermissions", () => ({
  usePermissions: () => ({ isAdmin: true, canManageCustomers: true }),
}));

import { PacotesPage } from "@/app/config/pacotes/PacotesPage";

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <PacotesPage />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

afterEach(cleanup);

describe("PacotesPage — Config admin (ADR-06)", () => {
  it("tabela tem caption e th com scope", () => {
    entitlementsMock.value = { pacotes: true, prontuario: false, aestheticCheckout: false, estoque: false, comissaoProduto: false };
    creditsMock.data = [
      {
        id: "cr-1",
        tenant_id: "t-1",
        customer_id: "c-1",
        service_id: "s-1",
        total_sessions: 5,
        used_sessions: 2,
        price_cents: 60000,
        validity_days: 30,
        expires_at: "2026-12-31T12:00:00.000Z",
        status: "active",
        created_at: "2026-01-01T00:00:00.000Z",
        customerName: "Maria",
        serviceName: "Limpeza de pele",
      },
    ];
    creditsMock.isLoading = false;
    creditsMock.isError = false;
    const { container } = renderPage();

    const caption = container.querySelector("table > caption");
    expect(caption?.textContent).toMatch(/pacotes vendidos/i);
    const headers = Array.from(container.querySelectorAll("th"));
    expect(headers.length).toBeGreaterThan(0);
    for (const th of headers) {
      expect(th.getAttribute("scope")).toBe("col");
    }
    expect(screen.getByText("Maria")).toBeDefined();
    expect(screen.getByText(/2\/5/)).toBeDefined();
  });

  it("admin abre o Dialog Novo pacote (CTA singular no PageHeader)", () => {
    entitlementsMock.value = { pacotes: true, prontuario: false, aestheticCheckout: false, estoque: false, comissaoProduto: false };
    creditsMock.data = [
      {
        id: "cr-1",
        tenant_id: "t-1",
        customer_id: "c-1",
        service_id: "s-1",
        total_sessions: 5,
        used_sessions: 2,
        price_cents: 60000,
        validity_days: 30,
        expires_at: "2026-12-31T12:00:00.000Z",
        status: "active",
        created_at: "2026-01-01T00:00:00.000Z",
        customerName: "Maria",
        serviceName: "Limpeza de pele",
      },
    ];
    creditsMock.isLoading = false;
    creditsMock.isError = false;
    renderPage();
    // Com dados na tabela há um único CTA "Novo pacote" (PageHeader) — sem
    // duplicata interna.
    fireEvent.click(screen.getByRole("button", { name: /novo pacote/i }));
    expect(screen.getByText("Vender pacote")).toBeDefined();
  });

  it("sem entitlement mostra upsell e não dispara venda", () => {
    entitlementsMock.value = null;
    creditsMock.data = [];
    creditsMock.isLoading = false;
    creditsMock.isError = false;
    renderPage();
    expect(screen.getByText(/não incluído no plano atual/i)).toBeDefined();
    expect(screen.getByRole("link", { name: /ver planos/i })).toBeDefined();
    expect(
      screen.queryByRole("button", { name: /novo pacote \(bloqueado\)/i }),
    ).toBeDefined();
    // Nenhum Dialog de venda aberto sem entitlement.
    expect(screen.queryByText("Vender pacote")).toBeNull();
  });

  it("linha vencida mostra badge Vencido", () => {
    entitlementsMock.value = { pacotes: true, prontuario: false, aestheticCheckout: false, estoque: false, comissaoProduto: false };
    creditsMock.data = [
      {
        id: "cr-2",
        tenant_id: "t-1",
        customer_id: "c-2",
        service_id: "s-1",
        total_sessions: 5,
        used_sessions: 1,
        price_cents: 60000,
        validity_days: 30,
        expires_at: "2020-01-01T00:00:00.000Z",
        status: "active",
        created_at: "2020-01-01T00:00:00.000Z",
        customerName: "Joana",
        serviceName: "Massagem",
      },
    ];
    renderPage();
    expect(screen.getByText("Vencido")).toBeDefined();
  });
});
