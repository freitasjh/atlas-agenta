// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FinanceiroPage } from "@/app/relatorios/FinanceiroPage";
import { makeMessagesSpy } from "@/app/agenda/pagamentos/payments-messages.spy";
import {
  paymentsMessages,
  type PaymentsMessages,
} from "@/app/agenda/pagamentos/payments-messages";

const mocks = vi.hoisted(() => ({
  summaryState: "success" as "success" | "loading" | "error" | "empty",
  canViewFinancials: true,
  payments: true as boolean | null,
  hookSpy: vi.fn(),
  refetch: vi.fn(),
  lastFetchStatus: "idle" as string,
}));

vi.mock("@/hooks/useFinancialSummary", () => ({
  useFinancialSummary: (...args: unknown[]) => {
    mocks.hookSpy(...args);
    const gated = mocks.canViewFinancials && mocks.payments === true;
    mocks.lastFetchStatus = gated ? "fetching" : "idle";
    if (!gated) {
      return { isLoading: false, isError: false, isSuccess: false, data: undefined, fetchStatus: "idle", refetch: mocks.refetch };
    }
    if (mocks.summaryState === "loading") {
      return { isLoading: true, isError: false, isSuccess: false, data: undefined, refetch: mocks.refetch };
    }
    if (mocks.summaryState === "error") {
      return { isLoading: false, isError: true, isSuccess: false, data: undefined, refetch: mocks.refetch };
    }
    if (mocks.summaryState === "empty") {
      return {
        isLoading: false,
        isError: false,
        isSuccess: true,
        data: {
          period: { from: "x", to: "y" },
          received_service_cents: 0,
          received_tips_cents: 0,
          received_total_cents: 0,
          receivable_cents: 0,
          open_cents: 0,
          by_method: [
            { method: "dinheiro", amount_cents: 0, tip_cents: 0, count: 0 },
            { method: "cartao_credito", amount_cents: 0, tip_cents: 0, count: 0 },
            { method: "cartao_debito", amount_cents: 0, tip_cents: 0, count: 0 },
            { method: "pix_sistema", amount_cents: 0, tip_cents: 0, count: 0 },
            { method: "pix_maquininha", amount_cents: 0, tip_cents: 0, count: 0 },
          ],
        },
        refetch: mocks.refetch,
      };
    }
    return {
      isLoading: false,
      isError: false,
      isSuccess: true,
      data: {
        period: { from: "2026-09-01T03:00:00.000Z", to: "2026-10-01T03:00:00.000Z" },
        received_service_cents: 11000,
        received_tips_cents: 500,
        received_total_cents: 11500,
        receivable_cents: 3000,
        open_cents: 9000,
        by_method: [
          { method: "dinheiro", amount_cents: 6000, tip_cents: 500, count: 1 },
          { method: "cartao_credito", amount_cents: 0, tip_cents: 0, count: 0 },
          { method: "cartao_debito", amount_cents: 0, tip_cents: 0, count: 0 },
          { method: "pix_sistema", amount_cents: 5000, tip_cents: 0, count: 1 },
          { method: "pix_maquininha", amount_cents: 0, tip_cents: 0, count: 0 },
        ],
      },
      refetch: mocks.refetch,
    };
  },
}));

vi.mock("@/hooks/usePermissions", () => ({
  usePermissions: () => ({ canViewFinancials: mocks.canViewFinancials }),
}));

vi.mock("@/hooks/useSegmentFeatures", () => ({
  useSegmentFeatures: () => ({ payments: mocks.payments }),
}));

vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({
    tenant: { timezone: "America/Sao_Paulo" },
  }),
}));

function renderPage(messages: PaymentsMessages = paymentsMessages) {  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    createElement(
      QueryClientProvider,
      { client: queryClient },
      createElement(
        MemoryRouter,
        null,
        createElement(FinanceiroPage, { messages }),
      ),
    ),
  );
}

beforeEach(() => {
  mocks.summaryState = "success";
  mocks.canViewFinancials = true;
  mocks.payments = true;
  mocks.hookSpy.mockClear();
  mocks.refetch.mockClear();
});

/** Intl pt-BR usa espaço não-separável após `R$`; normaliza para asserts. */
function norm(text: string | null): string {
  return (text ?? "").replace(/ /g, " ");
}

afterEach(() => cleanup());

describe("FinanceiroPage (ADR-005 §4)", () => {
  it("renderiza 2 grupos com rótulos de base, 4 cards e total como linha", () => {
    renderPage();
    expect(screen.getByText("Recebido")).toBeTruthy();
    expect(screen.getByText("Recebido no período (caixa)")).toBeTruthy();
    expect(screen.getByText("Pendências")).toBeTruthy();
    expect(screen.getByText("A receber agora · Em aberto no período")).toBeTruthy();

    const cards = screen.getAllByTestId(/^finance-card-/);
    expect(cards).toHaveLength(4);

    expect(norm(screen.getByTestId("finance-card-service").textContent)).toContain("R$ 110,00");
    expect(norm(screen.getByTestId("finance-card-tips").textContent)).toContain("R$ 5,00");
    expect(norm(screen.getByTestId("finance-total-line").textContent)).toContain("Recebido total");
    expect(norm(screen.getByTestId("finance-total-line").textContent)).toContain("R$ 115,00");
  });

  it("tabela por-método tem 5 linhas fixas com zeros e sem gráfico", () => {
    const { container } = renderPage();
    for (const label of ["Dinheiro", "Cartão de crédito", "Cartão de débito", "PIX do sistema", "PIX da maquininha"]) {
      expect(screen.getByText(label)).toBeTruthy();
    }
    expect(container.querySelector("svg.recharts-wrapper, svg")).toBeNull();
  });

  it("gorjeta em linha própria, sem somar na receita", () => {
    renderPage();
    const serviceCard = screen.getByTestId("finance-card-service");
    expect(norm(serviceCard.textContent)).not.toContain("R$ 115,00");
    expect(norm(screen.getByTestId("finance-card-tips").textContent)).toContain("R$ 5,00");
  });

  it("nota caixa × competência fixa presente", () => {
    renderPage();
    expect(
      screen.getByText("Comissão é por competência (concluído); este painel é caixa (recebido)."),
    ).toBeTruthy();
  });

  it("cards têm aria-label com valor e loading usa aria-busy", () => {
    renderPage();
    const serviceCard = screen.getByTestId("finance-card-service");
    expect(norm(serviceCard.getAttribute("aria-label"))).toContain("R$ 110,00");

    cleanup();
    mocks.summaryState = "loading";
    const { container } = renderPage();
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
  });

  it("sem acesso não dispara request e mostra neutro", () => {
    mocks.canViewFinancials = false;
    renderPage();
    expect(mocks.lastFetchStatus).toBe("idle");
    expect(screen.getByText("Você não tem acesso a este relatório.")).toBeTruthy();
  });

  it("fora de salão/barbearia mostra estado de ramo sem request", () => {
    mocks.payments = false;
    renderPage();
    expect(mocks.lastFetchStatus).toBe("idle");
    expect(
      screen.getByText("Este relatório está disponível apenas para salões e barbearias."),
    ).toBeTruthy();
  });

  it("clicar no preset ativo refaz a query mesmo com mesmos parâmetros (QA-ADR005-01)", () => {
    mocks.summaryState = "error";
    renderPage();
    expect(screen.getByText("Não foi possível carregar o relatório")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Este mês" }));
    expect(mocks.refetch).toHaveBeenCalledTimes(1);
  });

  it("usa exclusivamente o catálogo (sonda)", () => {
    const m = makeMessagesSpy();
    renderPage(m);
    expect(screen.getByText(m.financialSummary.groupReceived)).toBeTruthy();
    expect(screen.getByText(m.financialSummary.cashNote)).toBeTruthy();
    expect(screen.queryByText(paymentsMessages.financialSummary.groupReceived)).toBeNull();
    expect(screen.queryByText(paymentsMessages.financialSummary.cashNote)).toBeNull();
  });
});
