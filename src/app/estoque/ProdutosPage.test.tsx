// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  products: [] as Array<Record<string, unknown>>,
  entitlements: null as unknown,
  permissions: { isAdmin: true, canManageCatalog: true, isReceptionist: false },
  loading: false,
  error: false,
}));

vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({ data: mocks.products, isLoading: mocks.loading, isError: mocks.error, refetch: vi.fn() }),
  useCreateProduct: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateProduct: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeactivateProduct: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useProductProfessionals: () => ({ data: [], isLoading: false }),
}));

vi.mock("@/hooks/usePlanEntitlements", () => ({
  usePlanEntitlements: () => mocks.entitlements,
}));

vi.mock("@/hooks/usePermissions", () => ({
  usePermissions: () => mocks.permissions,
}));

vi.mock("@/hooks/useProfessionals", () => ({
  useProfessionals: () => ({ data: [], isLoading: false }),
}));

import { ProdutosPage } from "@/app/estoque/ProdutosPage";

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <ProdutosPage />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

afterEach(cleanup);

describe("ProdutosPage", () => {
  it("tabela tem caption e th com scope", () => {
    mocks.entitlements = { estoque: true, prontuario: false, pacotes: false, aestheticCheckout: false, comissaoProduto: false };
    mocks.products = [
      { id: "p1", tenant_id: "t1", name: "Shampoo", sku: "S1", category: "backbar", unit: "ml", cost_cents: 100, price_cents: 200, min_qty: 5, active: true, commission_pct: 0, stock_qty: 10, created_at: "2026-01-01T00:00:00Z" },
    ];
    mocks.loading = false;
    mocks.error = false;
    const { container } = renderPage();
    const caption = container.querySelector("table > caption");
    expect(caption).not.toBeNull();
    const headers = Array.from(container.querySelectorAll("th"));
    expect(headers.length).toBeGreaterThan(0);
    for (const th of headers) expect(th.getAttribute("scope")).toBe("col");
    expect(screen.getAllByText("Shampoo").length).toBeGreaterThan(0);
  });

  it("sem entitlement mostra upsell", () => {
    mocks.entitlements = null;
    mocks.products = [];
    mocks.loading = false;
    mocks.error = false;
    renderPage();
    expect(screen.getByText(/não incluído no plano atual/i)).toBeDefined();
    expect(screen.getByRole("link", { name: /ver planos/i })).toBeDefined();
  });

  it("produto esgotado mostra badge Esgotado", () => {
    mocks.entitlements = { estoque: true, prontuario: false, pacotes: false, aestheticCheckout: false, comissaoProduto: false };
    mocks.products = [
      { id: "p2", tenant_id: "t1", name: "Pomada", sku: null, category: "retail", unit: "un", cost_cents: 500, price_cents: 1000, min_qty: 2, active: true, commission_pct: 0, stock_qty: 0, created_at: "2026-01-01T00:00:00Z" },
    ];
    mocks.loading = false;
    mocks.error = false;
    renderPage();
    expect(screen.getByText("Esgotado")).toBeDefined();
  });
});