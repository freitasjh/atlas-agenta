// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useReceipts } from "@/hooks/useReceipts";

const mocks = vi.hoisted(() => ({
  timeZone: "America/Sao_Paulo" as string | undefined,
  canViewFinancials: true,
  payments: true as boolean | null,
  fromMock: vi.fn(),
  calls: [] as Array<{ op: string; args: unknown[] }>,
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
  supabase: { from: (...args: unknown[]) => mocks.fromMock(...args) },
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

const ROW = {
  id: "p-1",
  received_at: "2026-09-10T13:00:00.000Z",
  method: "dinheiro",
  amount_cents: 6000,
  tip_cents: 500,
  source: "manual",
  received_by: "u-1",
  voided_at: null,
  void_reason: null,
  charge_id: null,
  appointments: { customers: { name: "Cliente" } },
  operator: { full_name: "Admin" },
};

function makeQuery(rows: unknown[]) {
  const calls = mocks.calls;
  const q: Record<string, (...a: never[]) => unknown> = {};
  const chain = () => q;
  for (const op of ["select", "order", "eq", "gte", "lt", "is", "not", "range"] as const) {
    q[op] = (...args: never[]) => {
      calls.push({ op, args });
      return chain();
    };
  }
  q.then = (resolve: (v: unknown) => unknown) =>
    Promise.resolve({ data: { rows, total: 30 }, error: null }).then(resolve);
  return q;
}

beforeEach(() => {
  mocks.timeZone = "America/Sao_Paulo";
  mocks.canViewFinancials = true;
  mocks.payments = true;
  mocks.calls = [];
  mocks.fromMock.mockReset();
  mocks.fromMock.mockReturnValue(makeQuery([ROW]));
});

afterEach(() => cleanup());

const BASE = { from: "2026-09-01", to: "2026-09-30", method: "todos" as const, situacao: "todos" as const, page: 0 };

describe("useReceipts — paginação + filtros + RLS (ADR-005 §3)", () => {
  it("página 1 usa range(0,24) com count exact e ordena por received_at desc", async () => {
    const { result } = renderWithClient(() => useReceipts(BASE));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mocks.fromMock).toHaveBeenCalledWith("appointment_payments");
    const range = mocks.calls.find((c) => c.op === "range");
    expect(range?.args).toEqual([0, 24]);
    const order = mocks.calls.find((c) => c.op === "order");
    expect(order?.args).toEqual(["received_at", { ascending: false }]);
    const select = mocks.calls.find((c) => c.op === "select");
    expect(select?.args[1]).toMatchObject({ count: "exact" });
  });

  it("página 2 usa range(25,49)", async () => {
    const { result } = renderWithClient(() => useReceipts({ ...BASE, page: 1 }));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const range = mocks.calls.find((c) => c.op === "range");
    expect(range?.args).toEqual([25, 49]);
  });

  it("filtros de método e situação viram eq/is, período vira gte/lt no fuso", async () => {
    const { result } = renderWithClient(() =>
      useReceipts({ ...BASE, method: "pix_sistema", situacao: "ativos" }),
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const eqs = mocks.calls.filter((c) => c.op === "eq");
    expect(eqs.some((c) => c.args[0] === "method" && c.args[1] === "pix_sistema")).toBe(true);
    expect(mocks.calls.some((c) => c.op === "is" && c.args[0] === "voided_at")).toBe(true);
    const gte = mocks.calls.find((c) => c.op === "gte");
    expect(gte?.args).toEqual(["received_at", "2026-09-01T03:00:00.000Z"]);
  });

  it("estornados filtram voided_at not null", async () => {
    const { result } = renderWithClient(() => useReceipts({ ...BASE, situacao: "estornados" }));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mocks.calls.some((c) => c.op === "not" && c.args[0] === "voided_at")).toBe(true);
  });

  it("fora do gating não dispara request", () => {
    mocks.canViewFinancials = false;
    const { result } = renderWithClient(() => useReceipts(BASE));
    expect(mocks.fromMock).not.toHaveBeenCalled();
    expect(result.current.fetchStatus).toBe("idle");
  });

  it("normaliza linha com cliente e operador", async () => {
    const { result } = renderWithClient(() => useReceipts(BASE));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.rows[0]).toMatchObject({
      id: "p-1",
      customer_name: "Cliente",
      operator_name: "Admin",
      amount_cents: 6000,
    });
  });
});
