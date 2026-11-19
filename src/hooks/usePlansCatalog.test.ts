// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import { PLANS_CATALOG_KEY, usePlansCatalog } from "@/hooks/usePlansCatalog";
import { PLANS } from "@/lib/plans";

const { rpcMock } = vi.hoisted(() => ({ rpcMock: vi.fn() }));

vi.mock("@/lib/supabase", () => ({
  supabase: { rpc: rpcMock },
}));

function renderWithClient() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  const { result } = renderHook(() => usePlansCatalog(), {
    wrapper: ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client: queryClient }, children),
  });
  return result;
}

const CATALOG_ROWS = [
  { slug: "free", name: "Free", price_cents: 0, prof_limit: 1, appt_limit: 30, features: [], active: true, sort_order: 1 },
  { slug: "starter", name: "Starter", price_cents: 5900, prof_limit: 1, appt_limit: 150, features: [], active: true, sort_order: 2 },
  { slug: "premium", name: "Premium", price_cents: 14900, prof_limit: 5, appt_limit: null, features: [], active: true, sort_order: 3 },
  { slug: "enterprise", name: "Enterprise", price_cents: 25900, prof_limit: null, appt_limit: null, features: [], active: true, sort_order: 4 },
];

describe("usePlansCatalog", () => {
  it("usa a chave de cache do catálogo", () => {
    expect(PLANS_CATALOG_KEY).toEqual(["plans", "catalog"]);
  });

  it("resolve com o catálogo da RPC get_plans()", async () => {
    rpcMock.mockResolvedValueOnce({ data: CATALOG_ROWS, error: null });
    const result = renderWithClient();
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(rpcMock).toHaveBeenCalledWith("get_plans");
    expect(result.current.data?.map((p) => p.slug)).toEqual([
      "free",
      "starter",
      "premium",
      "enterprise",
    ]);
    expect(result.current.data?.find((p) => p.slug === "premium")?.price_cents).toBe(14900);
  });

  it("fallback estático quando a RPC falha", async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: { message: "boom" } });
    const result = renderWithClient();
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(PLANS);
  });

  it("fallback estático quando a RPC volta vazia", async () => {
    rpcMock.mockResolvedValueOnce({ data: [], error: null });
    const result = renderWithClient();
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(PLANS);
  });
});
