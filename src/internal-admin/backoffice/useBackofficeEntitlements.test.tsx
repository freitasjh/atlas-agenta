// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";

import {
  computeBackofficeEntitlements,
  useBackofficeEntitlements,
} from "@/internal-admin/backoffice/useBackofficeEntitlements";

const { rpcMock } = vi.hoisted(() => ({ rpcMock: vi.fn() }));

vi.mock("@/lib/supabase", () => ({
  supabase: { rpc: (...args: unknown[]) => rpcMock(...args) },
}));

afterEach(() => {
  cleanup();
  rpcMock.mockReset();
});

function row(slug: string, features: unknown, active = true) {
  return {
    slug,
    name: slug,
    price_cents: 5900,
    prof_limit: 1,
    appt_limit: 150,
    features,
    active,
    sort_order: 1,
  };
}

describe("computeBackofficeEntitlements", () => {
  it("libera T14/T15 quando um plano ativo expõe as flags", () => {
    expect(
      computeBackofficeEntitlements([
        row("starter", ["agendamento"], true),
        row("enterprise", ["backoffice_t14", "backoffice_t15"], true),
      ]),
    ).toEqual({ backofficeT14: true, backofficeT15: true });
  });

  it("flags em plano inativo não liberam", () => {
    expect(
      computeBackofficeEntitlements([
        row("enterprise", ["backoffice_t14", "backoffice_t15"], false),
      ]),
    ).toBeNull();
  });

  it("catálogo ativo sem as flags devolve ambos false", () => {
    expect(
      computeBackofficeEntitlements([row("starter", ["agendamento"], true)]),
    ).toEqual({ backofficeT14: false, backofficeT15: false });
  });

  it("dado sujo ou vazio degrada para null (sem liberação)", () => {
    expect(computeBackofficeEntitlements(null)).toBeNull();
    expect(computeBackofficeEntitlements("nope")).toBeNull();
    expect(computeBackofficeEntitlements([])).toBeNull();
    expect(
      computeBackofficeEntitlements([{ slug: "starter", features: [] }]),
    ).toBeNull();
  });
});

function wrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

describe("useBackofficeEntitlements", () => {
  it("lê o catálogo pela RPC get_plans e expõe ready", async () => {
    rpcMock.mockResolvedValue({
      data: [row("enterprise", ["backoffice_t14", "backoffice_t15"])],
      error: null,
    });
    const { result } = renderHook(() => useBackofficeEntitlements(), {
      wrapper: wrapper(),
    });
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(rpcMock).toHaveBeenCalledWith("get_plans");
    expect(result.current.entitlements).toEqual({
      backofficeT14: true,
      backofficeT15: true,
    });
  });

  it("falha de rede vira error (distinta de não incluído), nunca lança", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "boom" } });
    const { result } = renderHook(() => useBackofficeEntitlements(), {
      wrapper: wrapper(),
    });
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.entitlements).toBeNull();
    expect(typeof result.current.retry).toBe("function");
  });

  it("catálogo sem as flags vira ready com ambos false (não incluído)", async () => {
    rpcMock.mockResolvedValue({
      data: [row("starter", ["agendamento"])],
      error: null,
    });
    const { result } = renderHook(() => useBackofficeEntitlements(), {
      wrapper: wrapper(),
    });
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.entitlements).toEqual({
      backofficeT14: false,
      backofficeT15: false,
    });
  });
});
