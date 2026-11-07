// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Tabs, TabsContent } from "@/components/ui/tabs";
import { RecebimentosTab } from "@/app/cobrancas/RecebimentosTab";
import { makeMessagesSpy } from "@/app/agenda/pagamentos/payments-messages.spy";
import {
  paymentsMessages,
  type PaymentsMessages,
} from "@/app/agenda/pagamentos/payments-messages";
import {
  resolvePresetRange,
  todayIsoInTenantTz,
} from "@/lib/period-presets";

const mocks = vi.hoisted(() => ({
  receiptsState: "success" as "success" | "loading" | "error" | "empty",
  canViewFinancials: true,
  payments: true as boolean | null,
  receiptsSpy: vi.fn(),
  refetch: vi.fn(),
  lastFetchStatus: "idle" as string,
}));

vi.mock("@/hooks/useReceipts", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    useReceipts: (...args: unknown[]) => {
      mocks.receiptsSpy(...args);
      const gated = mocks.canViewFinancials && mocks.payments === true;
      mocks.lastFetchStatus = gated ? "fetching" : "idle";
      if (!gated) {
        return { isLoading: false, isError: false, isSuccess: false, data: undefined, fetchStatus: "idle", refetch: mocks.refetch };
      }
      return mockReceiptsResult();
    },
  };
});

function mockReceiptsResult() {
    if (mocks.receiptsState === "loading") {
      return { isLoading: true, isError: false, isSuccess: false, data: undefined, refetch: mocks.refetch };
    }
    if (mocks.receiptsState === "error") {
      return { isLoading: false, isError: true, isSuccess: false, data: undefined, refetch: mocks.refetch };
    }
    if (mocks.receiptsState === "empty") {
      return {
        isLoading: false,
        isError: false,
        isSuccess: true,
        data: { rows: [], total: 0 },
        refetch: mocks.refetch,
      };
    }
    return {
      isLoading: false,
      isError: false,
      isSuccess: true,
      data: {
        rows: [
          {
            id: "p-1",
            received_at: "2026-09-10T13:00:00.000Z",
            customer_name: "Cliente A",
            method: "dinheiro",
            amount_cents: 6000,
            tip_cents: 500,
            source: "manual",
            operator_name: "Admin",
            voided_at: null,
            void_reason: null,
            charge_id: null,
          },
          {
            id: "p-2",
            received_at: "2026-09-11T13:00:00.000Z",
            customer_name: "Cliente B",
            method: "pix_sistema",
            amount_cents: 3000,
            tip_cents: 0,
            source: "asaas",
            operator_name: "Admin",
            voided_at: "2026-09-12T00:00:00.000Z",
            void_reason: "teste",
            charge_id: "c-1",
          },
        ],
        total: 30,
      },
      refetch: mocks.refetch,
    };
}

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

function renderTab(messages: PaymentsMessages = paymentsMessages, initialEntries = ["/app/cobrancas?aba=recebimentos"]) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    createElement(
      QueryClientProvider,
      { client: queryClient },
      createElement(
        MemoryRouter,
        { initialEntries },
        createElement(
          Tabs,
          { defaultValue: "recebimentos" },
          createElement(
            TabsContent,
            { value: "recebimentos" },
            createElement(RecebimentosTab, { messages }),
          ),
        ),
      ),
    ),
  );
}

beforeEach(() => {
  mocks.receiptsState = "success";
  mocks.canViewFinancials = true;
  mocks.payments = true;
  mocks.receiptsSpy.mockClear();
  mocks.refetch.mockClear();
});

afterEach(() => cleanup());

describe("RecebimentosTab (ADR-005 §3)", () => {
  it("renderiza colunas completas e RealceRow na estornada", () => {
    renderTab();
    for (const header of ["Data/hora", "Cliente", "Forma", "Valor", "Gorjeta", "Operador/origem", "Status", "Vínculo PIX"]) {
      expect(screen.getAllByText(header).length).toBeGreaterThan(0);
    }
    expect(screen.getAllByText("Cliente A").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Cliente B").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Estornada").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Ativo").length).toBeGreaterThan(0);
    expect(screen.getAllByText("PIX").length).toBeGreaterThan(0);
    const voidedRow = screen.getAllByText("Cliente B")[0].closest("tr");
    expect(voidedRow?.className).toContain("text-muted-foreground");
  });

  it("fatura filtros próprios dentro do TabsContent, sem totais/exportação/estorno/QR", () => {
    const { container } = renderTab();
    const content = container.querySelector('[data-slot="tabs-content"], [role="tabpanel"]');
    expect(content).not.toBeNull();
    expect(screen.getByLabelText("Forma")).toBeTruthy();
    expect(screen.getByLabelText("Situação")).toBeTruthy();
    expect(screen.queryByText(/total/i)).toBeNull();
    expect(screen.queryByText(/exportar/i)).toBeNull();
    expect(screen.queryByText(/estornar/i)).toBeNull();
    expect(screen.queryByText(/QR/)).toBeNull();
  });

  it("paginação 25 com rótulo de página", () => {
    renderTab();
    const call = mocks.receiptsSpy.mock.calls[0]?.[0] as { page: number };
    expect(call.page).toBe(0);
    expect(screen.getByText("Página 1 de 2")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Próxima" }));
    const second = mocks.receiptsSpy.mock.calls.at(-1)?.[0] as { page: number };
    expect(second.page).toBe(1);
  });

  it("URL alimenta os filtros iniciais", () => {
    renderTab(paymentsMessages, [
      "/app/cobrancas?aba=recebimentos&metodo=pix_sistema&situacao=estornados",
    ]);
    const call = mocks.receiptsSpy.mock.calls[0]?.[0] as { method: string; situacao: string };
    expect(call.method).toBe("pix_sistema");
    expect(call.situacao).toBe("estornados");
  });

  it("clicar no preset ativo refaz a query mesmo com mesmos parâmetros (QA-ADR005-01)", () => {
    mocks.receiptsState = "error";
    // Período custom inválido (fim<início) → preset personalizado ativo + erro.
    renderTab(paymentsMessages, [
      "/app/cobrancas?aba=recebimentos&de=2026-11-30&ate=2026-11-01",
    ]);
    expect(screen.getByText("Não foi possível carregar os recebimentos")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Personalizado" }));
    expect(mocks.refetch).toHaveBeenCalledTimes(1);
  });

  it("recepção não vê a aba", () => {
    mocks.canViewFinancials = false;
    const { container } = renderTab();
    expect(container.textContent).toBe("");
    expect(mocks.lastFetchStatus).toBe("idle");
  });

  it("estados loading/vazio/erro+retry", () => {
    mocks.receiptsState = "loading";
    const loading = renderTab();
    expect(loading.container.querySelector('[aria-busy="true"]')).not.toBeNull();
    loading.unmount();
    cleanup();

    mocks.receiptsState = "empty";
    renderTab();
    expect(screen.getByText("Nenhum recebimento no período.")).toBeTruthy();
    cleanup();

    mocks.receiptsState = "error";
    renderTab();
    expect(screen.getByText("Não foi possível carregar os recebimentos")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Tentar novamente" })).toBeTruthy();
  });

  it("usa exclusivamente o catálogo (sonda)", () => {
    const m = makeMessagesSpy();
    renderTab(m);
    expect(screen.getByText(m.receipts.filters.method)).toBeTruthy();
    expect(screen.getByText(m.receipts.voided)).toBeTruthy();
    expect(screen.queryByText(paymentsMessages.receipts.filters.method)).toBeNull();
    expect(screen.queryByText(paymentsMessages.receipts.voided)).toBeNull();
  });

  it("trocar de preset deriva de/ate ancorados em today (não republica o range atual)", () => {
    const today = todayIsoInTenantTz("America/Sao_Paulo");
    renderTab(paymentsMessages, [
      "/app/cobrancas?aba=recebimentos&de=2026-01-05&ate=2026-01-06",
    ]);
    const before = mocks.receiptsSpy.mock.calls.at(-1)?.[0] as {
      from: string;
      to: string;
    };
    expect(before.from).toBe("2026-01-05");
    expect(before.to).toBe("2026-01-06");

    fireEvent.click(screen.getByRole("button", { name: "Mês passado" }));
    const prev = resolvePresetRange("mes-passado", today);
    const afterPrev = mocks.receiptsSpy.mock.calls.at(-1)?.[0] as {
      from: string;
      to: string;
    };
    expect(afterPrev.from).toBe(prev.start);
    expect(afterPrev.to).toBe(prev.end);

    fireEvent.click(screen.getByRole("button", { name: "Este mês" }));
    const cur = resolvePresetRange("mes", today);
    const afterCur = mocks.receiptsSpy.mock.calls.at(-1)?.[0] as {
      from: string;
      to: string;
    };
    expect(afterCur.from).toBe(cur.start);
    expect(afterCur.to).toBe(cur.end);
  });
});
