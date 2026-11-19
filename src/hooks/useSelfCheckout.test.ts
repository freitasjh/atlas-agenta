// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useCreateSelfCheckout } from "@/hooks/useSelfCheckout";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));

vi.mock("@/lib/supabase", () => ({
  supabase: { functions: { invoke: invokeMock } },
}));

afterEach(() => {
  cleanup();
  invokeMock.mockReset();
});

function wrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client }, children);
  };
}

const UPGRADE_RESPONSE = {
  kind: "upgrade",
  pix_qr_code: "qr",
  pix_copy_paste: "copia-e-cola",
  expires_at: "2030-01-01T00:00:00.000Z",
  effective_at: null,
};

describe("useCreateSelfCheckout (ADR-10/ADR-18)", () => {
  it("whenCheckoutRequested_thenInvokesCreateCheckoutWithoutTenantId", async () => {
    invokeMock.mockResolvedValue({ data: UPGRADE_RESPONSE, error: null });
    const { result } = renderHook(() => useCreateSelfCheckout(), {
      wrapper: wrapper(),
    });
    result.current.mutate({ plan: "premium" });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(invokeMock).toHaveBeenCalledTimes(1);
    const [fnName, options] = invokeMock.mock.calls[0] as [
      string,
      { body: Record<string, unknown> },
    ];
    expect(fnName).toBe("create-checkout");
    expect(options.body["plan"]).toBe("premium");
    expect(options.body).not.toHaveProperty("tenant_id");
    expect(options.body).not.toHaveProperty("tenantId");
    expect(typeof options.body["idempotency_key"]).toBe("string");
  });

  it("whenDowngrade_thenParsesEffectiveAt", async () => {
    invokeMock.mockResolvedValue({
      data: {
        kind: "downgrade",
        pix_qr_code: null,
        pix_copy_paste: null,
        expires_at: null,
        effective_at: "2030-02-01T03:00:00.000Z",
      },
      error: null,
    });
    const { result } = renderHook(() => useCreateSelfCheckout(), {
      wrapper: wrapper(),
    });
    result.current.mutate({ plan: "starter" });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.kind).toBe("downgrade");
    expect(result.current.data?.effective_at).toBe(
      "2030-02-01T03:00:00.000Z",
    );
  });

  it("whenFunctionFails_thenThrows", async () => {
    invokeMock.mockResolvedValue({
      data: null,
      error: new Error("falha de rede"),
    });
    const { result } = renderHook(() => useCreateSelfCheckout(), {
      wrapper: wrapper(),
    });
    result.current.mutate({ plan: "premium" });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeDefined();
  });

  it("whenResponseIsDirty_thenThrows", async () => {
    invokeMock.mockResolvedValue({
      data: { kind: "plano_magico" },
      error: null,
    });
    const { result } = renderHook(() => useCreateSelfCheckout(), {
      wrapper: wrapper(),
    });
    result.current.mutate({ plan: "premium" });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
