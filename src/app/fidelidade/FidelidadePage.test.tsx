// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  entitlements: null as unknown,
  program: null as unknown,
  accounts: [] as Array<Record<string, unknown>>,
  transactions: [] as Array<Record<string, unknown>>,
  coupons: [] as Array<Record<string, unknown>>,
  gifts: [] as Array<Record<string, unknown>>,
  txLoading: false,
  saveProgram: { mutateAsync: vi.fn(), isPending: false },
  saveCoupon: { mutateAsync: vi.fn(), isPending: false },
  issueGift: { mutateAsync: vi.fn(), isPending: false },
  refetch: vi.fn(),
  customerOptions: undefined as unknown,
}));

vi.mock("@/hooks/usePlanEntitlements", () => ({
  usePlanEntitlements: () => mocks.entitlements,
}));

vi.mock("@/hooks/usePermissions", () => ({
  usePermissions: () => ({
    isAdmin: true,
    canRegisterPayments: true,
  }),
}));

vi.mock("@/hooks/useFidelidade", () => ({
  useLoyaltyProgram: () => ({ data: mocks.program, isLoading: false, isError: false, refetch: mocks.refetch }),
  useLoyaltyAccounts: () => ({ data: mocks.accounts, isLoading: false, isError: false, refetch: mocks.refetch }),
  useLoyaltyTransactions: () => ({ data: mocks.transactions, isLoading: mocks.txLoading, isError: false }),
  useCoupons: () => ({ data: mocks.coupons, isLoading: false, isError: false }),
  useGiftCards: () => ({ data: mocks.gifts, isLoading: false, isError: false }),
  useSaveLoyaltyProgram: () => mocks.saveProgram,
  useSaveCoupon: () => mocks.saveCoupon,
  useIssueGiftCard: () => mocks.issueGift,
  useValidateCoupon: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useValidateGiftCard: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock("@/hooks/useCustomers", () => ({
  useCustomers: (options?: unknown) => {
    mocks.customerOptions = options;
    return { data: [], isLoading: false };
  },
}));

import { FidelidadePage } from "@/app/fidelidade/FidelidadePage";

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <FidelidadePage />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

afterEach(cleanup);

describe("FidelidadePage", () => {
  it("salva config do programa (ativo, pontos, expiração)", async () => {
    mocks.entitlements = { fidelidade: true };
    mocks.program = { id: "p1", tenant_id: "t1", active: true, points_per_real: 1, rounding: "floor", expiry_days: 180, levels: null };
    mocks.accounts = [];
    mocks.coupons = [];
    mocks.gifts = [];
    mocks.saveProgram.mutateAsync = vi.fn().mockResolvedValue({});
    renderPage();
    fireEvent.click(screen.getByRole("tab", { name: "Programa" }));
    fireEvent.click(screen.getByRole("button", { name: /salvar programa/i }));
    await waitFor(() => expect(mocks.saveProgram.mutateAsync).toHaveBeenCalled());
    expect(mocks.saveProgram.mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ active: true, points_per_real: 1 }),
    );
  });

  it("cartão exibe saldo e extrato", async () => {
    mocks.entitlements = { fidelidade: true };
    mocks.program = { id: "p1", tenant_id: "t1", active: true, points_per_real: 1, rounding: "floor", expiry_days: null, levels: null };
    mocks.accounts = [{ id: "a1", tenant_id: "t1", customer_id: "c1", balance_points: 120, lifetime_points: 200 }];
    mocks.transactions = [
      { id: "tx1", tenant_id: "t1", account_id: "a1", appointment_id: null, type: "credit", points: 120, reason: "Atendimento", expires_at: null, created_at: "2026-01-01T10:00:00.000Z" },
    ];
    mocks.coupons = [];
    mocks.gifts = [];
    renderPage();
    fireEvent.click(screen.getByRole("tab", { name: "Cartão do cliente" }));
    expect(await screen.findByText("Crédito")).toBeTruthy();
    expect(screen.getAllByText("120").length).toBeGreaterThan(0);
  });

  it("lista cupons e gift cards", async () => {
    mocks.entitlements = { fidelidade: true };
    mocks.program = { id: "p1", tenant_id: "t1", active: true, points_per_real: 1, rounding: "floor", expiry_days: null, levels: null };
    mocks.accounts = [];
    mocks.transactions = [];
    mocks.coupons = [
      { id: "cp1", tenant_id: "t1", code: "VOLTA10", type: "percent", value: 10, valid_from: null, valid_until: null, usage_limit: null, used_count: 0, active: true },
    ];
    mocks.gifts = [
      { id: "g1", tenant_id: "t1", code: "PRESENTE-1", initial_value_cents: 5000, balance_cents: 3000, valid_until: null, status: "active" },
    ];
    renderPage();
    fireEvent.click(screen.getByRole("tab", { name: "Cupons" }));
    expect(await screen.findByText("VOLTA10")).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "Gift cards" }));
    expect(await screen.findByText("PRESENTE-1")).toBeTruthy();
  });

  it("cria cupom via diálogo", async () => {
    mocks.entitlements = { fidelidade: true };
    mocks.program = { id: "p1", tenant_id: "t1", active: true, points_per_real: 1, rounding: "floor", expiry_days: null, levels: null };
    mocks.accounts = [];
    mocks.transactions = [];
    mocks.coupons = [];
    mocks.gifts = [];
    mocks.saveCoupon.mutateAsync = vi.fn().mockResolvedValue({});
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /novo cupom/i }));
    fireEvent.change(screen.getByLabelText("Código"), { target: { value: "VOLTA10" } });
    fireEvent.click(screen.getByRole("button", { name: /salvar cupom/i }));
    await waitFor(() => expect(mocks.saveCoupon.mutateAsync).toHaveBeenCalled());
  });

  it("sem entitlement mostra upsell e bloqueia ação", () => {
    mocks.entitlements = { fidelidade: false };
    mocks.program = null;
    mocks.accounts = [];
    mocks.transactions = [];
    mocks.coupons = [];
    mocks.gifts = [];
    renderPage();
    expect(screen.getByText(/recurso não incluído no plano atual/i)).toBeTruthy();
    expect(screen.getByRole("link", { name: /ver planos/i })).toBeTruthy();
  });

  it("gating: customers só dispara com entitlement (enabled)", () => {
    mocks.entitlements = { fidelidade: true };
    mocks.program = null;
    mocks.accounts = [];
    mocks.coupons = [];
    mocks.gifts = [];
    renderPage();
    expect(mocks.customerOptions).toMatchObject({ enabled: true });

    cleanup();
    mocks.entitlements = { fidelidade: false };
    renderPage();
    expect(mocks.customerOptions).toMatchObject({ enabled: false });
  });

  it("editor de níveis renderiza e persiste levels", async () => {
    mocks.entitlements = { fidelidade: true };
    mocks.program = {
      id: "p1",
      tenant_id: "t1",
      active: true,
      points_per_real: 1,
      rounding: "floor",
      expiry_days: null,
      levels: [{ name: "Ouro", min_points: 500 }],
    };
    mocks.accounts = [];
    mocks.coupons = [];
    mocks.gifts = [];
    mocks.saveProgram.mutateAsync = vi.fn().mockResolvedValue({});
    renderPage();
    fireEvent.click(screen.getByRole("tab", { name: "Programa" }));
    const levels = screen.getByLabelText(/níveis/i) as HTMLTextAreaElement;
    // Níveis do servidor serializados no editor (nada descartado).
    expect(levels.value).toContain("Ouro:500");
    fireEvent.change(levels, { target: { value: "Prata:100\nOuro:500" } });
    fireEvent.click(screen.getByRole("button", { name: /salvar programa/i }));
    await waitFor(() => expect(mocks.saveProgram.mutateAsync).toHaveBeenCalled());
    expect(mocks.saveProgram.mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        levels: [
          { name: "Prata", min_points: 100 },
          { name: "Ouro", min_points: 500 },
        ],
      }),
    );
  });

  it("diálogo de cupom expõe validade e limite de usos", async () => {
    mocks.entitlements = { fidelidade: true };
    mocks.program = { id: "p1", tenant_id: "t1", active: true, points_per_real: 1, rounding: "floor", expiry_days: null, levels: null };
    mocks.accounts = [];
    mocks.transactions = [];
    mocks.coupons = [];
    mocks.gifts = [];
    mocks.saveCoupon.mutateAsync = vi.fn().mockResolvedValue({});
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /novo cupom/i }));
    fireEvent.change(screen.getByLabelText("Código"), { target: { value: "VOLTA10" } });
    fireEvent.change(screen.getByLabelText(/válido até/i), { target: { value: "2026-12-31" } });
    fireEvent.change(screen.getByLabelText(/limite de usos/i), { target: { value: "100" } });
    fireEvent.click(screen.getByRole("button", { name: /salvar cupom/i }));
    await waitFor(() => expect(mocks.saveCoupon.mutateAsync).toHaveBeenCalled());
    expect(mocks.saveCoupon.mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ valid_until: "2026-12-31", usage_limit: 100 }),
    );
  });

  it("diálogo de gift expõe validade", async () => {
    mocks.entitlements = { fidelidade: true };
    mocks.program = { id: "p1", tenant_id: "t1", active: true, points_per_real: 1, rounding: "floor", expiry_days: null, levels: null };
    mocks.accounts = [];
    mocks.transactions = [];
    mocks.coupons = [];
    mocks.gifts = [];
    mocks.issueGift.mutateAsync = vi.fn().mockResolvedValue({});
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /emitir gift card/i }));
    fireEvent.change(screen.getByLabelText("Código"), { target: { value: "PRESENTE-1" } });
    fireEvent.change(screen.getByLabelText(/valor inicial/i), { target: { value: "50,00" } });
    fireEvent.change(screen.getByLabelText(/válido até/i), { target: { value: "2026-12-31" } });
    fireEvent.click(screen.getByRole("button", { name: /^emitir$/i }));
    await waitFor(() => expect(mocks.issueGift.mutateAsync).toHaveBeenCalled());
    expect(mocks.issueGift.mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ valid_until: "2026-12-31" }),
    );
  });
});
