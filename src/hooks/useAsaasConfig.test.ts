// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider, onlineManager } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ASAAS_CONFIG_KEY,
  useAsaasConfig,
  useTestAsaasConnection,
  useSaveAsaasConfig,
  asaasConfigRowSchema,
} from "@/hooks/useAsaasConfig";

const { fromMock, invokeMock } = vi.hoisted(() => ({
  fromMock: vi.fn(),
  invokeMock: vi.fn(),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: fromMock,
    functions: { invoke: invokeMock },
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

const ROW = {
  tenant_id: "t-1",
  asaas_account_id: "acc-1",
  environment: "sandbox",
  active: true,
  created_at: "2026-11-01T00:00:00.000Z",
  updated_at: "2026-11-01T00:00:00.000Z",
};

beforeEach(() => {
  fromMock.mockReset();
  invokeMock.mockReset();
});

afterEach(() => {
  onlineManager.setOnline(true);
  cleanup();
});

describe("useAsaasConfig", () => {
  it("lê config sob RLS e valida com zod", async () => {
    fromMock.mockReturnValue({
      select: () => ({
        maybeSingle: async () => ({ data: ROW, error: null }),
      }),
    });

    const { result } = renderWithClient(() => useAsaasConfig());
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(fromMock).toHaveBeenCalledWith("tenant_asaas_config");
    expect(result.current.data?.tenant_id).toBe("t-1");
    expect(() => asaasConfigRowSchema.parse(ROW)).not.toThrow();
  });

  it("retorna null quando não há config", async () => {
    fromMock.mockReturnValue({
      select: () => ({
        maybeSingle: async () => ({ data: null, error: null }),
      }),
    });

    const { result } = renderWithClient(() => useAsaasConfig());
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
  });

  it("lança em erro do PostgREST", async () => {
    fromMock.mockReturnValue({
      select: () => ({
        maybeSingle: async () => ({ data: null, error: { message: "rls" } }),
      }),
    });

    const { result } = renderWithClient(() => useAsaasConfig());
    await waitFor(() => expect(result.current.isError).toBe(true));
  });

  it("não pausa sob offline (networkMode always) — o capture precisa resolver", async () => {
    onlineManager.setOnline(false);
    fromMock.mockReturnValue({
      select: () => ({
        maybeSingle: async () => ({ data: ROW, error: null }),
      }),
    });

    const { result } = renderWithClient(() => useAsaasConfig());
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(fromMock).toHaveBeenCalledWith("tenant_asaas_config");
    expect(result.current.fetchStatus).not.toBe("paused");
  });
});

describe("useTestAsaasConnection", () => {
  it("invoca test-asaas-connection com {apiKey, environment}", async () => {
    invokeMock.mockResolvedValue({
      data: { ok: true, account_id: "acc-1", name: "Conta" },
      error: null,
    });

    const { result } = renderWithClient(() => useTestAsaasConnection());
    await act(async () => {
      await result.current.mutateAsync({ apiKey: "key", environment: "sandbox" });
    });

    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock.mock.calls[0]?.[0]).toBe("test-asaas-connection");
    expect(invokeMock.mock.calls[0]?.[1]).toMatchObject({
      body: { apiKey: "key", environment: "sandbox" },
    });
  });

  it("propaga erro do invoke", async () => {
    invokeMock.mockResolvedValue({ data: null, error: { message: "forbidden" } });

    const { result } = renderWithClient(() => useTestAsaasConnection());
    await expect(
      result.current.mutateAsync({ apiKey: "key", environment: "sandbox" }),
    ).rejects.toBeTruthy();
  });
});

describe("useSaveAsaasConfig", () => {
  it("invoca save-asaas-config e invalida cache", async () => {
    invokeMock.mockResolvedValue({
      data: { ok: true, webhook_token: "tok", account_id: "acc-1" },
      error: null,
    });

    const { result, queryClient } = renderWithClient(() => useSaveAsaasConfig());
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    await act(async () => {
      await result.current.mutateAsync({ apiKey: "key", environment: "production" });
    });

    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock.mock.calls[0]?.[0]).toBe("save-asaas-config");
    expect(invokeMock.mock.calls[0]?.[1]).toMatchObject({
      body: { apiKey: "key", environment: "production" },
    });
    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: ASAAS_CONFIG_KEY }),
    );
  });

  it("propaga erro do invoke", async () => {
    invokeMock.mockResolvedValue({ data: null, error: { message: "forbidden" } });

    const { result } = renderWithClient(() => useSaveAsaasConfig());
    await expect(
      result.current.mutateAsync({ apiKey: "key", environment: "sandbox" }),
    ).rejects.toBeTruthy();
  });
});