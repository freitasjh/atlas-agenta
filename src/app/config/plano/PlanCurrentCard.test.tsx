// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PlanCurrentCard } from "@/app/config/plano/PlanCurrentCard";
import { PLANS } from "@/lib/plans";

const mocks = vi.hoisted(() => ({
  limits: null as { profLimit: number | null; apptLimit: number | null } | null,
  limitsLoading: false,
  professionals: 2 as number | null,
  tenant: { timezone: "America/Sao_Paulo" } as unknown,
  catalog: [] as typeof PLANS,
  catalogLoading: false,
  catalogError: false,
}));

vi.mock("@/hooks/usePlanLimits", () => ({
  usePlanLimits: () => ({
    limits: mocks.limits,
    isLoading: mocks.limitsLoading,
  }),
}));

vi.mock("@/hooks/useProfessionals", () => ({
  useProfessionals: () => ({ data: mocks.professionals, isLoading: false }),
}));

vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ tenant: mocks.tenant }),
}));

afterEach(cleanup);

mocks.catalog = [...PLANS];

function renderCard(planSlug: string | null = "starter") {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <PlanCurrentCard
          planSlug={planSlug}
          subscriptionStatus="ativo"
          catalog={[...mocks.catalog]}
          catalogLoading={mocks.catalogLoading}
          catalogError={mocks.catalogError}
          onRetryCatalog={vi.fn()}
          enabled
        />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe("PlanCurrentCard (RF-35)", () => {
  it("whenStarter_thenShowsPlanQuotaAndRealUsage", () => {
    mocks.limits = { profLimit: 1, apptLimit: 150 };
    mocks.professionals = 1;
    renderCard("starter");
    expect(screen.getByText("Starter")).toBeDefined();
    expect(screen.getByText("ativo")).toBeDefined();
    expect(screen.getByText(/Profissionais em uso/)).toBeDefined();
    expect(screen.getByText(/Agendamentos no mês/)).toBeDefined();
  });

  it("whenNullPlan_thenShowsNoPlanGuide", () => {
    renderCard(null);
    expect(screen.getByText(/Nenhum plano vinculado/)).toBeDefined();
  });

  it("whenCatalogLoading_thenShowsBusySkeleton", () => {
    mocks.catalogLoading = true;
    try {
      renderCard("starter");
      expect(screen.getByLabelText(/Carregando plano/)).toBeDefined();
    } finally {
      mocks.catalogLoading = false;
    }
  });

  it("whenCatalogError_thenShowsRetry", () => {
    mocks.catalogError = true;
    try {
      renderCard("starter");
      expect(
        screen.getByText(/Não foi possível carregar o plano/),
      ).toBeDefined();
    } finally {
      mocks.catalogError = false;
    }
  });
});
