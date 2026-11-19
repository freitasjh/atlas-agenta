// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import * as React from "react";
import { describe, expect, it, vi } from "vitest";

import {
  mapPackageError,
  usePackageBalance,
  useSellPackage,
} from "@/hooks/usePackageCredits";

const { rpcMock, fromMock } = vi.hoisted(() => ({
  rpcMock: vi.fn(),
  fromMock: vi.fn(),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: { rpc: rpcMock, from: fromMock },
}));

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

describe("usePackageBalance — leitura escopada (ADR-06)", () => {
  it("não dispara request sem cliente", () => {
    rpcMock.mockClear();
    renderHook(() => usePackageBalance(null), { wrapper });
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("lê saldo via get_package_balance e valida o shape", async () => {
    rpcMock.mockResolvedValueOnce({
      data: [
        {
          credit_id: "cr-1",
          service_id: "s-1",
          total_sessions: 5,
          used_sessions: 2,
          remaining: 3,
          expires_at: new Date(Date.now() + 86400000).toISOString(),
          expired: false,
          status: "active",
        },
      ],
      error: null,
    });
    const { result } = renderHook(() => usePackageBalance("c-1"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(rpcMock).toHaveBeenCalledWith("get_package_balance", {
      p_customer_id: "c-1",
    });
    expect(result.current.data?.[0]?.remaining).toBe(3);
  });
});

describe("useSellPackage — venda via RPC (ADR-06)", () => {
  it("chama sell_package com os parâmetros mapeados", async () => {
    rpcMock.mockResolvedValueOnce({ data: "novo-credito-id", error: null });
    const { result } = renderHook(() => useSellPackage(), { wrapper });
    const id = await result.current.mutateAsync({
      customerId: "c-1",
      serviceId: "s-1",
      totalSessions: 5,
      priceCents: 60000,
      validityDays: 30,
    });
    expect(id).toBe("novo-credito-id");
    expect(rpcMock).toHaveBeenCalledWith("sell_package", {
      p_customer_id: "c-1",
      p_service_id: "s-1",
      p_total_sessions: 5,
      p_price_cents: 60000,
      p_validity_days: 30,
    });
  });
});

describe("mapPackageError — erros tipados em pt-BR", () => {
  it("traduz vencido, esgotado e negação de papel", () => {
    expect(mapPackageError(new Error("PACKAGE_CREDIT_EXPIRED"))).toMatch(
      /vencido/i,
    );
    expect(mapPackageError(new Error("PACKAGE_CREDIT_EXHAUSTED"))).toMatch(
      /esgotado/i,
    );
    expect(mapPackageError(new Error("PACKAGE_SELL_DENIED"))).toMatch(
      /não pode vender/i,
    );
  });

  it("cai no genérico sem vazar detalhe", () => {
    expect(mapPackageError(new Error("qualquer coisa"))).toMatch(
      /não foi possível concluir/i,
    );
  });
});
