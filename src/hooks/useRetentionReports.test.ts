// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  useCohortHighlight,
  useRetencaoReport,
  useRetentionSummary,
  useTicketReport,
  useUtilizacaoReport,
  useWhatsappResponseRate,
} from "@/hooks/useRetentionReports";

const mocks = vi.hoisted(() => ({
  timeZone: "America/Sao_Paulo" as string | undefined,
  isAdmin: true,
  rpcMock: vi.fn(),
}));

vi.mock("@/hooks/useTenant", () => ({
  useTenant: () => ({ data: mocks.timeZone ? { timezone: mocks.timeZone } : undefined }),
}));

vi.mock("@/hooks/usePermissions", () => ({
  usePermissions: () => ({ isAdmin: mocks.isAdmin }),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: { rpc: (...args: unknown[]) => mocks.rpcMock(...args) },
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

const FILTER = { startDate: "2026-09-01", endDate: "2026-09-30", professionalId: null, serviceId: null };

const SUMMARY_RAW = {
  period: { from: "2026-09-01T03:00:00.000Z", to: "2026-10-01T03:00:00.000Z" },
  noshow: { no_show_rate: 0.1, no_show_count: 1, completed_count: 8, confirmed_count: 1, denominator: 10 },
  rebooking: { rebooking_rate: 0.4, active_customers: 10, repeat_customers: 4 },
  utilization: { utilization_rate: 0.75, occupied_minutes: 450, available_minutes: 600, by_professional: [] },
  ticket: { average_ticket_cents: 8000, total_cents: 80000, completed_count: 10 },
};

beforeEach(() => {
  mocks.timeZone = "America/Sao_Paulo";
  mocks.isAdmin = true;
  mocks.rpcMock.mockReset();
});

afterEach(() => cleanup());

describe("useRetentionReports — contrato real das RPCs (C1)", () => {
  it("summary chama report_retention_summary só com p_from/p_to e achata o aninhado", async () => {
    mocks.rpcMock.mockResolvedValue({ data: SUMMARY_RAW, error: null });
    const { result } = renderWithClient(() => useRetentionSummary(FILTER));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mocks.rpcMock).toHaveBeenCalledTimes(1);
    expect(mocks.rpcMock.mock.calls[0]?.[0]).toBe("report_retention_summary");
    const args = mocks.rpcMock.mock.calls[0]?.[1] as Record<string, unknown>;
    // Trava os nomes reais do banco: p_from/p_to, sem p_start/p_end e sem filtros.
    expect(Object.keys(args).sort()).toEqual(["p_from", "p_to"]);
    expect(args.p_from).toBe("2026-09-01T03:00:00.000Z");
    expect(args.p_to).toBe("2026-10-01T03:00:00.000Z");

    expect(result.current.data).toEqual({
      rebooking_rate: 0.4,
      noshow_rate: 0.1,
      utilization_rate: 0.75,
      ticket_medio_cents: 8000,
    });
  });

  it("retencao usa p_from/p_to, coorte com data completa + p_windows [90] e mapeia agregado→linhas", async () => {
    mocks.rpcMock.mockImplementation((fn: string) => {
      if (fn === "report_rebooking_rate")
        return Promise.resolve({
          data: { rebooking_rate: 0.4, active_customers: 10, repeat_customers: 4 },
          error: null,
        });
      if (fn === "report_noshow_rate")
        return Promise.resolve({
          data: { no_show_rate: 0.1, no_show_count: 1, denominator: 10 },
          error: null,
        });
      if (fn === "report_cohort_retention")
        return Promise.resolve({
          data: {
            cohort_month: "2026-09",
            cohort_size: 20,
            windows: [{ window_days: 90, retained_customers: 8, retention_rate: 0.4 }],
          },
          error: null,
        });
      throw new Error(`unexpected rpc ${fn}`);
    });

    const { result } = renderWithClient(() => useRetencaoReport(FILTER));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const calls = Object.fromEntries(mocks.rpcMock.mock.calls.map((c) => [c[0], c[1]]));
    expect(Object.keys(calls).sort()).toEqual([
      "report_cohort_retention",
      "report_noshow_rate",
      "report_rebooking_rate",
    ]);
    const rebookingArgs = calls["report_rebooking_rate"] as Record<string, unknown>;
    expect(Object.keys(rebookingArgs).sort()).toEqual([
      "p_from",
      "p_professional_id",
      "p_service_id",
      "p_to",
    ]);
    const cohortArgs = calls["report_cohort_retention"] as Record<string, unknown>;
    // Data completa + janela única de 90 dias.
    expect(cohortArgs.p_cohort_month).toBe("2026-09-01");
    expect(cohortArgs.p_windows).toEqual([90]);

    expect(result.current.data?.rebooking).toEqual([
      { key: "total", label: "Período", rate: 0.4, numerator: 4, denominator: 10 },
    ]);
    expect(result.current.data?.noshow).toEqual([
      { key: "total", label: "Período", rate: 0.1, numerator: 1, denominator: 10 },
    ]);
    expect(result.current.data?.cohorts).toEqual([
      { cohort: "2026-09", cohort_size: 20, retained_count: 8, retention_rate: 0.4 },
    ]);
  });

  it("utilizacao mapeia by_professional real e ticket mapeia agregado→linha única", async () => {
    mocks.rpcMock.mockResolvedValueOnce({
      data: {
        utilization_rate: 0.75,
        occupied_minutes: 450,
        available_minutes: 600,
        by_professional: [
          { professional_id: "p1", occupied_minutes: 450, available_minutes: 600, utilization_rate: 0.75 },
        ],
      },
      error: null,
    });
    const u = renderWithClient(() => useUtilizacaoReport(FILTER));
    await waitFor(() => expect(u.result.current.isSuccess).toBe(true));
    expect(mocks.rpcMock.mock.calls[0]?.[0]).toBe("report_utilization");
    expect(u.result.current.data).toEqual([
      { key: "p1", label: "p1", utilization_rate: 0.75, occupied_minutes: 450, available_minutes: 600 },
    ]);

    mocks.rpcMock.mockReset();
    mocks.rpcMock.mockResolvedValue({
      data: { average_ticket_cents: 8000, total_cents: 80000, completed_count: 10 },
      error: null,
    });
    const t = renderWithClient(() => useTicketReport(FILTER));
    await waitFor(() => expect(t.result.current.isSuccess).toBe(true));
    expect(mocks.rpcMock.mock.calls[0]?.[0]).toBe("report_ticket_medio");
    expect(t.result.current.data).toEqual([
      { key: "total", label: "Período", ticket_medio_cents: 8000, total_cents: 80000, appointment_count: 10 },
    ]);
  });

  it("whatsapp usa whatsapp_kpis (fonte real) e coorte usa o mês inicial", async () => {
    mocks.rpcMock.mockResolvedValue({
      data: { enviadas: 10, respostas: 9, delivery_rate: 1, read_rate: 0.9, failure_rate: 0 },
      error: null,
    });
    const w = renderWithClient(() => useWhatsappResponseRate(FILTER));
    await waitFor(() => expect(w.result.current.isSuccess).toBe(true));
    expect(mocks.rpcMock.mock.calls[0]?.[0]).toBe("whatsapp_kpis");
    expect(w.result.current.data?.response_rate).toBeCloseTo(0.9, 4);

    mocks.rpcMock.mockReset();
    mocks.rpcMock.mockResolvedValue({
      data: {
        cohort_month: "2026-09",
        cohort_size: 20,
        windows: [{ window_days: 90, retained_customers: 7, retention_rate: 0.35 }],
      },
      error: null,
    });
    const c = renderWithClient(() => useCohortHighlight(FILTER));
    await waitFor(() => expect(c.result.current.isSuccess).toBe(true));
    const args = mocks.rpcMock.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(args.p_cohort_month).toBe("2026-09-01");
    expect(c.result.current.data?.retention_rate).toBe(0.35);
  });

  it("não-admin não dispara nenhum request", () => {
    mocks.isAdmin = false;
    const { result } = renderWithClient(() => useRetentionSummary(FILTER));
    expect(mocks.rpcMock).not.toHaveBeenCalled();
    expect(result.current.fetchStatus).toBe("idle");
  });
});
