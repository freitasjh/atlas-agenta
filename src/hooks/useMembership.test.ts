// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, renderHook } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useUpdateMembershipStatus } from "@/hooks/useMembership";

const { rpcMock } = vi.hoisted(() => ({ rpcMock: vi.fn() }));

vi.mock("@/lib/supabase", () => ({
  supabase: { from: vi.fn(), rpc: (...args: unknown[]) => rpcMock(...args) },
}));

function renderMutation() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const { result } = renderHook(() => useUpdateMembershipStatus(), {
    wrapper: ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client: queryClient }, children),
  });
  return result;
}

const SUB_ID = "44444444-4444-4444-8444-444444444444";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("useUpdateMembershipStatus — contrato RPC p_status/p_reason", () => {
  it("pausar → p_status=pausada", async () => {
    rpcMock.mockResolvedValue({ data: "pausada", error: null });
    const result = renderMutation();
    await result.current.mutateAsync({ subscriptionId: SUB_ID, acao: "pausar" });
    expect(rpcMock).toHaveBeenCalledWith("membership_update_status", {
      p_subscription_id: SUB_ID,
      p_status: "pausada",
      p_reason: null,
    });
  });

  it("retomar → p_status=ativa", async () => {
    rpcMock.mockResolvedValue({ data: "ativa", error: null });
    const result = renderMutation();
    const out = await result.current.mutateAsync({
      subscriptionId: SUB_ID,
      acao: "retomar",
    });
    expect(rpcMock).toHaveBeenCalledWith("membership_update_status", {
      p_subscription_id: SUB_ID,
      p_status: "ativa",
      p_reason: null,
    });
    expect(out.status).toBe("ativa");
  });

  it("cancelar → p_status=cancelada + p_reason=motivo", async () => {
    rpcMock.mockResolvedValue({ data: "cancelada", error: null });
    const result = renderMutation();
    const out = await result.current.mutateAsync({
      subscriptionId: SUB_ID,
      acao: "cancelar",
      motivo: "Cliente pediu",
    });
    expect(rpcMock).toHaveBeenCalledWith("membership_update_status", {
      p_subscription_id: SUB_ID,
      p_status: "cancelada",
      p_reason: "Cliente pediu",
    });
    expect(out.status).toBe("cancelada");
  });

  it("nunca envia p_acao/p_motivo (contrato antigo)", async () => {
    rpcMock.mockResolvedValue({ data: "pausada", error: null });
    const result = renderMutation();
    await result.current.mutateAsync({ subscriptionId: SUB_ID, acao: "pausar" });
    const payload = rpcMock.mock.calls[0][1] as Record<string, unknown>;
    expect(payload).not.toHaveProperty("p_acao");
    expect(payload).not.toHaveProperty("p_motivo");
  });
});
