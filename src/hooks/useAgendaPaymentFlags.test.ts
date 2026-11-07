// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useAgendaPaymentFlags } from "@/hooks/useAgendaPaymentFlags";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));

vi.mock("@/lib/supabase", () => ({
  supabase: { functions: { invoke: invokeMock } },
}));

function renderWithClient<T>(hook: () => T) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  const { result } = renderHook(hook, {
    wrapper: ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client: queryClient }, children),
  });
  return { result };
}

const ROWS = [
  { id: "a-1", price_cents: 10000, status: "concluido" as const },
  { id: "a-2", price_cents: 10000, status: "concluido" as const },
  { id: "a-3", price_cents: 0, status: "concluido" as const },
];

beforeEach(() => invokeMock.mockReset());
afterEach(() => cleanup());

describe("useAgendaPaymentFlags", () => {
  it("desabilitado não dispara query e devolve unknown para todos", () => {
    const { result } = renderWithClient(() =>
      useAgendaPaymentFlags(ROWS, { enabled: false }),
    );
    expect(invokeMock).not.toHaveBeenCalled();
    expect(result.current.statusById.get("a-1")).toBe("unknown");
    expect(result.current.statusById.get("a-3")).toBe("unknown");
    expect(result.current.pendingCount).toBe(0);
  });

  it("lê em lote pela Edge e conta pendentes", async () => {
    invokeMock.mockResolvedValue({
      data: {
        statuses: [
          { appointment_id: "a-1", payment_status: "parcial" },
          { appointment_id: "a-2", payment_status: "quitado" },
        ],
      },
      error: null,
    });
    const { result } = renderWithClient(() => useAgendaPaymentFlags(ROWS));

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock.mock.calls[0]?.[0]).toBe("get-agenda-payment-statuses");
    expect(invokeMock.mock.calls[0]?.[1]).toEqual({
      body: { appointment_ids: ["a-1", "a-2", "a-3"] },
    });
    expect(result.current.statusById.get("a-1")).toBe("parcial");
    expect(result.current.statusById.get("a-2")).toBe("quitado");
    // Total zero é quitado pela precedência da ADR-002 (fallback local).
    expect(result.current.statusById.get("a-3")).toBe("quitado");
    expect(result.current.pendingCount).toBe(1);
  });

  it("contador ignora em_atendimento e só conta concluídos com pendência", async () => {
    invokeMock.mockResolvedValue({
      data: {
        statuses: [
          { appointment_id: "a-1", payment_status: "parcial" },
          { appointment_id: "a-4", payment_status: "sem_pagamento" },
          { appointment_id: "a-5", payment_status: "aguardando_pix" },
        ],
      },
      error: null,
    });
    const rows = [
      ...ROWS,
      { id: "a-4", price_cents: 10000, status: "em_atendimento" as const },
      { id: "a-5", price_cents: 10000, status: "pendente" as const },
    ];
    const { result } = renderWithClient(() => useAgendaPaymentFlags(rows));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.statusById.get("a-4")).toBe("sem_pagamento");
    expect(result.current.statusById.get("a-5")).toBe("aguardando_pix");
    // a-1 (concluido/parcial) é o único selo real; a-2 é quitado e a-3 é
    // total zero; a-4/a-5 ainda não concluíram.
    expect(result.current.pendingCount).toBe(1);
  });

  it("divide lotes acima de 200 ids", async () => {
    invokeMock.mockImplementation(async (...args: unknown[]) => {
      const options = args[1] as { body?: { appointment_ids?: string[] } } | undefined;
      const ids = options?.body?.appointment_ids ?? [];
      return {
        data: {
          statuses: ids.map((id) => ({
            appointment_id: id,
            payment_status: "sem_pagamento",
          })),
        },
        error: null,
      };
    });
    const rows = Array.from({ length: 250 }, (_, index) => ({
      id: `a-${index}`,
      price_cents: 1000,
      status: "concluido" as const,
    }));
    const { result } = renderWithClient(() => useAgendaPaymentFlags(rows));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(invokeMock).toHaveBeenCalledTimes(2);
    expect(result.current.pendingCount).toBe(250);
  });

  it("erro sinaliza isError sem inventar selo", async () => {
    invokeMock.mockResolvedValue({ data: null, error: { message: "boom" } });
    const { result } = renderWithClient(() => useAgendaPaymentFlags(ROWS));
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.statusById.get("a-1")).toBe("unknown");
  });
});
