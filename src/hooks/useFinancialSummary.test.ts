// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useFinancialSummary } from "@/hooks/useFinancialSummary";

const mocks = vi.hoisted(() => ({
  timeZone: "America/Sao_Paulo" as string | undefined,
  canViewFinancials: true,
  payments: true as boolean | null,
  rpcMock: vi.fn(),
}));

vi.mock("@/hooks/useTenant", () => ({
  useTenant: () => ({ data: mocks.timeZone ? { timezone: mocks.timeZone } : undefined }),
}));

vi.mock("@/hooks/usePermissions", () => ({
  usePermissions: () => ({ canViewFinancials: mocks.canViewFinancials }),
}));

vi.mock("@/hooks/useSegmentFeatures", () => ({
  useSegmentFeatures: () => ({ payments: mocks.payments }),
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

const SUMMARY = {
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
};

beforeEach(() => {
  mocks.timeZone = "America/Sao_Paulo";
  mocks.canViewFinancials = true;
  mocks.payments = true;
  mocks.rpcMock.mockReset();
  mocks.rpcMock.mockResolvedValue({ data: SUMMARY, error: null });
});

afterEach(() => cleanup());

describe("useFinancialSummary — gating + contrato (ADR-005 §2)", () => {
  it("admin + payments dispara rpc sem tenant_id e com ISO do fuso", async () => {
    const { result } = renderWithClient(() =>
      useFinancialSummary({ startDate: "2026-09-01", endDate: "2026-09-30" }),
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mocks.rpcMock).toHaveBeenCalledTimes(1);
    expect(mocks.rpcMock.mock.calls[0]?.[0]).toBe("financial_summary");
    const args = mocks.rpcMock.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(Object.keys(args).sort()).toEqual(["p_from", "p_to"]);
    expect(args.p_from).toBe("2026-09-01T03:00:00.000Z");
    expect(args.p_to).toBe("2026-10-01T03:00:00.000Z");
    expect(result.current.data?.received_service_cents).toBe(11000);
  });

  it("recepção não dispara request", () => {
    mocks.canViewFinancials = false;
    const { result } = renderWithClient(() =>
      useFinancialSummary({ startDate: "2026-09-01", endDate: "2026-09-30" }),
    );
    expect(mocks.rpcMock).not.toHaveBeenCalled();
    expect(result.current.fetchStatus).toBe("idle");
  });

  it("payments=false (clínica/legado) não dispara request", () => {
    mocks.payments = false;
    const { result } = renderWithClient(() =>
      useFinancialSummary({ startDate: "2026-09-01", endDate: "2026-09-30" }),
    );
    expect(mocks.rpcMock).not.toHaveBeenCalled();
    expect(result.current.fetchStatus).toBe("idle");
  });

  it("sem fuso resolvido não dispara request", () => {
    mocks.timeZone = undefined;
    const { result } = renderWithClient(() =>
      useFinancialSummary({ startDate: "2026-09-01", endDate: "2026-09-30" }),
    );
    expect(mocks.rpcMock).not.toHaveBeenCalled();
    expect(result.current.fetchStatus).toBe("idle");
  });

  it("resposta fora do contrato é rejeitada (zod)", async () => {
    mocks.rpcMock.mockResolvedValue({
      data: { received_service_cents: 1, pago: 999 },
      error: null,
    });
    const { result } = renderWithClient(() =>
      useFinancialSummary({ startDate: "2026-09-01", endDate: "2026-09-30" }),
    );
    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
