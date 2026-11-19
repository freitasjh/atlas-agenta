// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PlanoPage } from "@/app/config/plano/PlanoPage";
import { PLANS } from "@/lib/plans";
import type { AestheticEntitlements } from "@/hooks/usePlanEntitlements";

const mocks = vi.hoisted(() => ({
  entitlements: null as AestheticEntitlements | null,
  tenant: {
    id: "tenant-1",
    plan: "starter",
    subscription_status: "ativo",
    timezone: "America/Sao_Paulo",
  } as unknown,
  subscriptionStatus: "ativo" as string | null,
  role: "admin" as string | null,
  catalogLoading: false,
  catalogError: false,
  refetch: vi.fn(),
  limits: { profLimit: 1, apptLimit: 150 } as unknown,
  professionals: 1 as unknown,
  charges: [] as unknown[],
  chargesLoading: false,
  chargesError: false,
  checkout: {
    mutate: vi.fn(),
    isPending: false,
    isError: false,
    data: null as unknown,
    reset: vi.fn(),
  },
}));

vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({
    tenant: mocks.tenant,
    subscriptionStatus: mocks.subscriptionStatus,
    role: mocks.role,
  }),
}));

vi.mock("@/hooks/usePlanEntitlements", () => ({
  usePlanEntitlements: () => mocks.entitlements,
}));

vi.mock("@/hooks/usePlansCatalog", () => ({
  usePlansCatalog: () => ({
    data: [...PLANS],
    isLoading: mocks.catalogLoading,
    isError: mocks.catalogError,
    refetch: mocks.refetch,
  }),
}));

vi.mock("@/hooks/usePlanLimits", () => ({
  usePlanLimits: () => ({ limits: mocks.limits, isLoading: false }),
}));

vi.mock("@/hooks/useProfessionals", () => ({
  useProfessionals: () => ({ data: mocks.professionals, isLoading: false }),
}));

vi.mock("@/hooks/useSubscriptionCharges", () => ({
  useSubscriptionCharges: () => ({
    data: mocks.charges,
    isLoading: mocks.chargesLoading,
    isError: mocks.chargesError,
    refetch: vi.fn(),
  }),
}));

vi.mock("@/hooks/useSelfCheckout", () => ({
  useCreateSelfCheckout: () => mocks.checkout,
}));

const FULL_ENTITLEMENTS: AestheticEntitlements = {
  prontuario: true,
  pacotes: false,
  aestheticCheckout: true,
  estoque: false,
  comissaoProduto: false,
  deposito: false,
  waitlist: false,
  campanhas: false,
  fidelidade: false,
  checkoutSelfService: true,
  nfce: false,
  recorrencia: false,
  contasPagar: false,
  conciliacao: false,
  dreFluxo: false,
  exportContabil: false,
  backofficeT14: false,
  backofficeT15: false,
};

afterEach(() => {
  cleanup();
  mocks.entitlements = null;
  mocks.subscriptionStatus = "ativo";
  mocks.role = "admin";
  mocks.catalogLoading = false;
  mocks.catalogError = false;
  mocks.checkout.isError = false;
  mocks.checkout.data = null;
});

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <PlanoPage />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe("PlanoPage — /app/config/plano (ADR-18 G)", () => {
  it("degrada sem entitlements sem travar (estado-guia)", () => {
    mocks.entitlements = null;
    renderPage();
    expect(screen.getByText(/Informações de uso indisponíveis/)).toBeDefined();
  });

  it("lista os 3 recursos com estado liberado/bloqueado", () => {
    mocks.entitlements = { ...FULL_ENTITLEMENTS };
    renderPage();
    expect(screen.getByText("Prontuário")).toBeDefined();
    expect(screen.getByText("Pacotes de sessões")).toBeDefined();
    expect(screen.getByText("Checkout estética")).toBeDefined();
    expect(screen.getAllByText("Liberado").length).toBe(2);
    expect(screen.getByText("Bloqueado")).toBeDefined();
  });

  it("recurso bloqueado oferece upsell para /precos", () => {
    mocks.entitlements = {
      ...FULL_ENTITLEMENTS,
      prontuario: false,
      aestheticCheckout: false,
    };
    renderPage();
    expect(
      screen.getByRole("link", { name: /ver planos/i }).getAttribute("href"),
    ).toBe("/precos");
    expect(
      screen.getByRole("link", { name: /ver todos os planos/i }).getAttribute("href"),
    ).toBe("/precos");
  });

  it("não dispara request sensível quando entitlements é null", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("sem rede"));
    try {
      mocks.entitlements = null;
      renderPage();
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("quando ativo mostra plano atual, fatura e checkout", () => {
    mocks.entitlements = { ...FULL_ENTITLEMENTS };
    renderPage();
    expect(screen.getByLabelText(/Plano atual: Starter/)).toBeDefined();
    expect(screen.getByText("Fatura atual")).toBeDefined();
    expect(screen.getByText("Histórico de faturas")).toBeDefined();
    expect(screen.getByText("Trocar de plano")).toBeDefined();
  });

  it("quando bloqueado mostra faixa de quitacao", () => {
    mocks.entitlements = { ...FULL_ENTITLEMENTS };
    mocks.subscriptionStatus = "bloqueado";
    renderPage();
    expect(screen.getByRole("alert")).toBeDefined();
    expect(screen.getByText(/Conta bloqueada/)).toBeDefined();
  });

  it("quando cancelado mostra faixa de reativacao", () => {
    mocks.entitlements = { ...FULL_ENTITLEMENTS };
    mocks.subscriptionStatus = "cancelado";
    renderPage();
    expect(screen.getByText(/Assinatura cancelada/)).toBeDefined();
    expect(screen.getByText(/Reativar assinatura/)).toBeDefined();
  });

  it("quando pendente mostra aguardando pagamento", () => {
    mocks.entitlements = { ...FULL_ENTITLEMENTS };
    mocks.subscriptionStatus = "pendente";
    renderPage();
    expect(screen.getByText(/Pagamento pendente/)).toBeDefined();
  });

  it("quando trial mostra nota com upsell", () => {
    mocks.entitlements = { ...FULL_ENTITLEMENTS };
    mocks.subscriptionStatus = "trial";
    renderPage();
    expect(screen.getByText(/período de teste/)).toBeDefined();
  });

  it("sem checkoutSelfService mostra upsell do checkout", () => {
    mocks.entitlements = { ...FULL_ENTITLEMENTS, checkoutSelfService: false };
    renderPage();
    expect(
      screen.getByText(/recurso não incluído no plano atual/),
    ).toBeDefined();
    expect(mocks.checkout.mutate).not.toHaveBeenCalled();
  });

  it("quando checkout falha mostra erro com retry", () => {
    mocks.entitlements = { ...FULL_ENTITLEMENTS };
    mocks.checkout.isError = true;
    renderPage();
    expect(
      screen.getByText(/Não foi possível gerar a cobrança/),
    ).toBeDefined();
  });

  it("quando nao-admin nao mostra fatura nem checkout e nao dispara fetch", () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("sem rede"));
    try {
      mocks.entitlements = { ...FULL_ENTITLEMENTS };
      mocks.role = "receptionist";
      renderPage();
      // Plano atual e recursos seguem visíveis; cobrança/checkout, não.
      expect(screen.getByLabelText(/Plano atual: Starter/)).toBeDefined();
      expect(screen.queryByText("Fatura atual")).toBeNull();
      expect(screen.queryByText("Histórico de faturas")).toBeNull();
      expect(screen.queryByText("Trocar de plano")).toBeNull();
      expect(mocks.checkout.mutate).not.toHaveBeenCalled();
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });
});
