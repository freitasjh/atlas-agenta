// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useCreatePublicBookingLink, usePublicBookingLink } from "@/hooks/usePublicBookingLink";

const { fromMock, rpcMock } = vi.hoisted(() => ({
  fromMock: vi.fn(),
  rpcMock: vi.fn(),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: fromMock,
    rpc: rpcMock,
  },
}));

function renderWithClient<T>(hook: () => T) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } },
  });
  const { result } = renderHook(hook, {
    wrapper: ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client: queryClient }, children),
  });
  return { result, queryClient };
}

beforeEach(() => {
  fromMock.mockReset();
  rpcMock.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("usePublicBookingLink", () => {
  it("retorna null quando não há link ativo", async () => {
    fromMock.mockReturnValue({
      select: () => ({
        eq: () => ({
          order: () => ({
            limit: async () => ({ data: [], error: null }),
          }),
        }),
      }),
    });

    const { result } = renderWithClient(() => usePublicBookingLink());
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
  });

  it("lê link ativo e valida com zod", async () => {
    const row = { token: "11111111-2222-4333-8444-555555555555", created_at: "2026-11-01T00:00:00.000Z" };
    fromMock.mockReturnValue({
      select: () => ({
        eq: () => ({
          order: () => ({
            limit: async () => ({ data: [row], error: null }),
          }),
        }),
      }),
    });

    const { result } = renderWithClient(() => usePublicBookingLink());
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.token).toBe(row.token);
  });
});

describe("useCreatePublicBookingLink", () => {
  it("invoca create_public_booking_link e invalida cache", async () => {
    rpcMock.mockResolvedValue({
      data: [{ token: "11111111-2222-4333-8444-555555555555", created_at: "2026-11-01T00:00:00.000Z" }],
      error: null,
    });
    const { result, queryClient } = renderWithClient(() => useCreatePublicBookingLink());
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
    await act(async () => {
      await result.current.mutateAsync("tenant-1");
    });
    expect(rpcMock).toHaveBeenCalledWith("create_public_booking_link", { p_tenant_id: "tenant-1" });
    expect(invalidateSpy).toHaveBeenCalled();
  });
});