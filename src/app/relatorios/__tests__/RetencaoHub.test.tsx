// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RelatoriosHubPage } from "@/app/relatorios/RelatoriosHubPage";

const mocks = vi.hoisted(() => ({
  canViewFinancials: true,
  canViewCommission: false,
  payments: true as boolean | null,
  commission: false as boolean | null,
  isAdmin: true,
  summaryState: "success" as "success" | "loading",
}));

vi.mock("@/hooks/usePermissions", () => ({
  usePermissions: () => ({
    canViewFinancials: mocks.canViewFinancials,
    canViewCommission: mocks.canViewCommission,
    isAdmin: mocks.isAdmin,
  }),
}));

vi.mock("@/hooks/useSegmentFeatures", () => ({
  useSegmentFeatures: () => ({
    payments: mocks.payments,
    commission: mocks.commission,
  }),
}));

vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ tenant: { timezone: "America/Sao_Paulo" } }),
}));

vi.mock("@/hooks/useRetentionReports", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/hooks/useRetentionReports")>();
  return {
    ...actual,
    useRetentionSummary: () => {
      if (mocks.summaryState === "loading") {
        return { isLoading: true, isError: false, data: undefined };
      }
      return {
        isLoading: false,
        isError: false,
        data: {
          rebooking_rate: 0.4,
          noshow_rate: 0.1,
          utilization_rate: 0.75,
          ticket_medio_cents: 8000,
        },
      };
    },
    useCohortHighlight: () => {
      if (mocks.summaryState === "loading") {
        return { isLoading: true, isError: false, data: undefined };
      }
      return { isLoading: false, isError: false, data: { retention_rate: 0.35, cohort_size: 20 } };
    },
    useWhatsappResponseRate: () => {
      if (mocks.summaryState === "loading") {
        return { isLoading: true, isError: false, data: undefined };
      }
      return { isLoading: false, isError: false, data: { response_rate: 0.9 } };
    },
  };
});

function renderHub() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children);
  return render(
    createElement(MemoryRouter, null, createElement(wrapper, null, createElement(RelatoriosHubPage))),
  );
}

beforeEach(() => {
  mocks.canViewFinancials = true;
  mocks.canViewCommission = false;
  mocks.payments = true;
  mocks.commission = false;
  mocks.isAdmin = true;
  mocks.summaryState = "success";
});

afterEach(() => cleanup());

describe("RelatoriosHubPage — retenção (ADR-17, RF-31)", () => {
  it("admin vê os 6 cards de retenção com métricas resumo e links", () => {
    const { container } = renderHub();
    for (const titulo of ["Rebooking", "No-show", "Utilização", "Ticket médio", "Retenção por coorte", "WhatsApp"]) {
      expect(screen.getByText(titulo)).toBeTruthy();
    }
    const links = container.querySelectorAll('a[href="/app/relatorios/retencao"]');
    expect(links.length).toBeGreaterThanOrEqual(3);
    expect(container.querySelector('a[href="/app/relatorios/utilizacao"]')).not.toBeNull();
    expect(container.querySelector('a[href="/app/relatorios/ticket"]')).not.toBeNull();
  });

  it("não-admin não vê a seção de retenção", () => {
    mocks.isAdmin = false;
    mocks.canViewFinancials = false;
    renderHub();
    expect(screen.queryByText("Rebooking")).toBeNull();
    expect(screen.queryByText("Ticket médio")).toBeNull();
    expect(screen.getByText("Nenhum relatório disponível ainda")).toBeTruthy();
  });

  it("loading do resumo mostra skeleton sem quebrar", () => {
    mocks.summaryState = "loading";
    const { container } = renderHub();
    expect(container.querySelector('[aria-busy="true"]') ?? null).toBeTruthy();
  });
});
