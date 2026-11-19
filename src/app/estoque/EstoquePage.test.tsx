// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  products: [] as Array<Record<string, unknown>>,
  stock: [] as Array<Record<string, unknown>>,
  entitlements: null as unknown,
  permissions: { isAdmin: true, isReceptionist: false, canManageCatalog: true },
  loading: false,
  error: false,
}));

vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({ data: mocks.products, isLoading: mocks.loading, isError: mocks.error, refetch: vi.fn() }),
}));

vi.mock("@/hooks/useStock", () => ({
  useStock: () => ({ data: mocks.stock, isLoading: mocks.loading, isError: mocks.error, refetch: vi.fn() }),
  useStockAlerts: () => ({ data: mocks.stock, isLoading: mocks.loading, isError: mocks.error, refetch: vi.fn() }),
  useLowStock: () => ({ data: mocks.stock, isLoading: mocks.loading, isError: mocks.error, refetch: vi.fn() }),
  useReplenishStock: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useAdjustStock: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useConsumeStock: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useStockMovements: () => ({ data: [], isLoading: false }),
}));

vi.mock("@/hooks/usePlanEntitlements", () => ({
  usePlanEntitlements: () => mocks.entitlements,
}));

vi.mock("@/hooks/usePermissions", () => ({
  usePermissions: () => mocks.permissions,
}));

import { EstoquePage } from "@/app/estoque/EstoquePage";

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <EstoquePage />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

afterEach(cleanup);

describe("EstoquePage", () => {
  it("KPIs de alerta contam críticos e baixos", () => {
    mocks.entitlements = { estoque: true, prontuario: false, pacotes: false, aestheticCheckout: false, comissaoProduto: false };
    mocks.permissions = { isAdmin: true, isReceptionist: false, canManageCatalog: true };
    mocks.products = [
      { id: "p1", tenant_id: "t1", name: "Shampoo", sku: null, category: "backbar", unit: "ml", cost_cents: 100, price_cents: 200, min_qty: 5, active: true, commission_pct: 0, stock_qty: 0, created_at: "2026-01-01T00:00:00Z" },
      { id: "p2", tenant_id: "t1", name: "Pomada", sku: null, category: "retail", unit: "un", cost_cents: 500, price_cents: 1000, min_qty: 4, active: true, commission_pct: 0, stock_qty: 3, created_at: "2026-01-01T00:00:00Z" },
      { id: "p3", tenant_id: "t1", name: "Gel", sku: null, category: "both", unit: "un", cost_cents: 200, price_cents: 400, min_qty: 2, active: true, commission_pct: 0, stock_qty: 10, created_at: "2026-01-01T00:00:00Z" },
    ];
    mocks.stock = [];
    mocks.loading = false;
    mocks.error = false;
    renderPage();
    expect(screen.getByText("Críticos")).toBeDefined();
    // critical count 1
    expect(screen.getAllByText("1").length).toBeGreaterThan(0);
    expect(screen.getByText("Baixos")).toBeDefined();
  });

  it("status badges exibem Crítico/Baixo/OK", () => {
    mocks.entitlements = { estoque: true, prontuario: false, pacotes: false, aestheticCheckout: false, comissaoProduto: false };
    mocks.permissions = { isAdmin: true, isReceptionist: false, canManageCatalog: true };
    mocks.products = [
      { id: "p1", tenant_id: "t1", name: "Shampoo", sku: null, category: "backbar", unit: "ml", cost_cents: 100, price_cents: 200, min_qty: 5, active: true, commission_pct: 0, stock_qty: 0, created_at: "2026-01-01T00:00:00Z" },
      { id: "p2", tenant_id: "t1", name: "Pomada", sku: null, category: "retail", unit: "un", cost_cents: 500, price_cents: 1000, min_qty: 4, active: true, commission_pct: 0, stock_qty: 3, created_at: "2026-01-01T00:00:00Z" },
      { id: "p3", tenant_id: "t1", name: "Gel", sku: null, category: "both", unit: "un", cost_cents: 200, price_cents: 400, min_qty: 2, active: true, commission_pct: 0, stock_qty: 10, created_at: "2026-01-01T00:00:00Z" },
    ];
    mocks.stock = [];
    mocks.loading = false;
    mocks.error = false;
    renderPage();
    expect(screen.getAllByText("Crítico").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Baixo").length).toBeGreaterThan(0);
    expect(screen.getAllByText("OK").length).toBeGreaterThan(0);
  });

  it("sem entitlement mostra upsell", () => {
    mocks.entitlements = null;
    mocks.products = [];
    mocks.stock = [];
    mocks.loading = false;
    mocks.error = false;
    renderPage();
    expect(screen.getByText(/não incluído no plano atual/i)).toBeDefined();
    expect(screen.getByRole("link", { name: /ver planos/i })).toBeDefined();
  });

  it("receptionist não vê valores monetários (RBAC sem R$)", () => {
    mocks.entitlements = { estoque: true, prontuario: false, pacotes: false, aestheticCheckout: false, comissaoProduto: false };
    mocks.permissions = { isAdmin: false, isReceptionist: true, canManageCatalog: false };
    mocks.products = [
      { id: "p1", tenant_id: "t1", name: "Shampoo", sku: null, category: "backbar", unit: "ml", cost_cents: 100, price_cents: 200, min_qty: 5, active: true, commission_pct: 0, stock_qty: 10, created_at: "2026-01-01T00:00:00Z" },
    ];
    mocks.stock = [];
    mocks.loading = false;
    mocks.error = false;
    const { container } = renderPage();
    // receptionist não tem botão Ajustar (admin only)
    expect(screen.queryByRole("button", { name: /ajustar/i })).toBeNull();
    // sem R$ literal no texto renderizado (custo não exibido)
    expect(container.textContent).not.toMatch(/R\$/);
  });
});