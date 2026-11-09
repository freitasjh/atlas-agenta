// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FechamentoBalcao } from "@/app/relatorios/FechamentoBalcao";
import { paymentsMessages } from "@/app/agenda/pagamentos/payments-messages";

vi.mock("@/hooks/useFechamentoBalcao", () => ({
  useFechamentoBalcao: () => ({
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
    data: {
      expectedCents: 15000,
      tipsCents: 1000,
      voidedCount: 1,
      voidedCents: 2000,
      byOperator: [{ operatorName: "Recepção Ana", count: 3, amountCents: 15000 }],
      byMethod: [{ method: "dinheiro", amountCents: 15000, count: 3 }],
    },
  }),
}));

function wrapper(children: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return createElement(QueryClientProvider, { client }, children);
}

afterEach(() => cleanup());

describe("FechamentoBalcao — só leitura (ADR-24)", () => {
  it("mostra esperado, gorjetas, estornos e operador", () => {
    const t = paymentsMessages.financialSummary;
    render(
      wrapper(createElement(FechamentoBalcao, {
        start: "2026-11-09",
        end: "2026-11-09",
        messages: paymentsMessages,
      })),
    );
    expect(screen.getByText(t.closingTitle)).toBeTruthy();
    expect(screen.getByText(t.onlyBalcao)).toBeTruthy();
    expect(screen.getByText(t.closingReadOnly)).toBeTruthy();
    expect(screen.getByText("Recepção Ana")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Salvar" })).toBeNull();
  });
});
