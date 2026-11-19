// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { usePlanLimits } from "@/hooks/usePlanLimits";

const { rpcMock } = vi.hoisted(() => ({ rpcMock: vi.fn() }));

vi.mock("@/lib/supabase", () => ({
  supabase: { rpc: rpcMock },
}));

afterEach(() => {
  cleanup();
  rpcMock.mockReset();
});

function wrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client }, children);
  };
}

const ROWS = [
  {
    slug: "starter",
    name: "Starter",
    price_cents: 5900,
    prof_limit: 1,
    appt_limit: 150,
    features: ["agendamento"],
    active: true,
    sort_order: 2,
  },
  {
    slug: "premium",
    name: "Premium",
    price_cents: 14900,
    prof_limit: 5,
    appt_limit: null,
    features: ["agendamento"],
    active: true,
    sort_order: 3,
  },
];

describe("usePlanLimits (ADR-18)", () => {
  it("whenSlugInCatalog_thenReturnsLimits", async () => {
    rpcMock.mockResolvedValue({ data: ROWS, error: null });
    const { result } = renderHook(() => usePlanLimits("starter"), {
      wrapper: wrapper(),
    });
    await waitFor(() => expect(result.current.limits).not.toBeNull());
    expect(result.current.limits).toEqual({ profLimit: 1, apptLimit: 150 });
  });

  it("whenSlugUnknown_thenNull", async () => {
    rpcMock.mockResolvedValue({ data: ROWS, error: null });
    const { result } = renderHook(() => usePlanLimits("plano_magico"), {
      wrapper: wrapper(),
    });
    await waitFor(() =>
      expect(rpcMock).toHaveBeenCalledWith("get_plans"),
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.limits).toBeNull();
  });

  it("whenRpcFails_thenNullWithoutThrowing", async () => {
    rpcMock.mockResolvedValue({ data: null, error: new Error("rede") });
    const { result } = renderHook(() => usePlanLimits("starter"), {
      wrapper: wrapper(),
    });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.limits).toBeNull();
  });

  it("whenDisabled_thenNoRequest", () => {
    const { result } = renderHook(
      () => usePlanLimits("starter", { enabled: false }),
      { wrapper: wrapper() },
    );
    expect(rpcMock).not.toHaveBeenCalled();
    expect(result.current.limits).toBeNull();
  });

  it("whenSlugNull_thenNoRequest", () => {
    const { result } = renderHook(() => usePlanLimits(null), {
      wrapper: wrapper(),
    });
    expect(rpcMock).not.toHaveBeenCalled();
    expect(result.current.limits).toBeNull();
  });
});
