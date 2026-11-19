// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  useCreateService,
  useServices,
  useUpdateService,
} from "@/hooks/useServices";

const { fromMock } = vi.hoisted(() => ({ fromMock: vi.fn() }));

vi.mock("@/lib/supabase", () => ({
  supabase: { from: fromMock },
}));

function makeChain(result: { data: unknown; error: unknown }) {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {};
  chain.select = vi.fn(() => chain);
  chain.order = vi.fn(() => Promise.resolve(result));
  chain.eq = vi.fn(() => chain);
  chain.single = vi.fn(() => Promise.resolve(result));
  chain.insert = vi.fn(() => chain);
  chain.update = vi.fn(() => chain);
  return chain;
}

function renderWithClient<T>(hook: () => T) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { retry: false },
    },
  });
  const { result } = renderHook(hook, {
    wrapper: ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client: queryClient }, children),
  });
  return { result, queryClient };
}

const BASE_ROW = {
  id: "11111111-1111-4111-8111-111111111111",
  tenant_id: "t-1",
  name: "Corte",
  duration_minutes: 30,
  processing_minutes: 0,
  price_cents: 10000,
  backbar_cost_cents: 0,
  active: true,
  created_at: "2026-11-01T10:00:00.000Z",
};

const DEPOSIT_ROW = {
  ...BASE_ROW,
  deposit_enabled: true,
  deposit_type: "percent",
  deposit_value: 30,
  deposit_deadline_hours: 48,
  deposit_refund_policy: "total",
  deposit_refund_percent: null,
};

beforeEach(() => {
  fromMock.mockReset();
});

afterEach(cleanup);

describe("useServices — deposit_* (ADR-12 / ADR-02)", () => {
  it("lista carrega as colunas deposit_*", async () => {
    fromMock.mockReturnValue(
      makeChain({ data: [DEPOSIT_ROW], error: null }),
    );
    const { result } = renderWithClient(() => useServices());

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const [service] = result.current.data ?? [];
    expect(service?.deposit_enabled).toBe(true);
    expect(service?.deposit_type).toBe("percent");
    expect(service?.deposit_value).toBe(30);
    expect(service?.deposit_deadline_hours).toBe(48);
    expect(service?.deposit_refund_policy).toBe("total");
  });

  it("linha legada sem deposit_* degrada para desabilitado", async () => {
    fromMock.mockReturnValue(makeChain({ data: [BASE_ROW], error: null }));
    const { result } = renderWithClient(() => useServices());

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const [service] = result.current.data ?? [];
    expect(service?.deposit_enabled).toBe(false);
    expect(service?.deposit_type).toBeNull();
    expect(service?.deposit_refund_policy).toBe("none");
  });

  it("criar persiste as colunas deposit_*", async () => {
    const chain = makeChain({ data: DEPOSIT_ROW, error: null });
    fromMock.mockReturnValue(chain);
    const { result } = renderWithClient(() => useCreateService());

    await result.current.mutateAsync({
      name: "Corte",
      durationMinutes: 30,
      processingMinutes: 0,
      priceCents: 10000,
      backbarCostCents: 0,
      active: true,
      deposit: {
        enabled: true,
        type: "percent",
        value: 30,
        deadlineHours: 48,
        refundPolicy: "total",
        refundPercent: null,
      },
    });

    expect(chain.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        deposit_enabled: true,
        deposit_type: "percent",
        deposit_value: 30,
        deposit_deadline_hours: 48,
        deposit_refund_policy: "total",
        deposit_refund_percent: null,
      }),
    );
  });

  it("criar sem bloco deposit grava desabilitado (sem null sensível)", async () => {
    const chain = makeChain({ data: BASE_ROW, error: null });
    fromMock.mockReturnValue(chain);
    const { result } = renderWithClient(() => useCreateService());

    await result.current.mutateAsync({
      name: "Corte",
      durationMinutes: 30,
      processingMinutes: 0,
      priceCents: 10000,
      backbarCostCents: 0,
      active: true,
    });

    expect(chain.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        deposit_enabled: false,
        deposit_type: null,
        deposit_value: 0,
        deposit_deadline_hours: 24,
        deposit_refund_policy: "none",
        deposit_refund_percent: null,
      }),
    );
  });

  it("atualizar persiste as colunas deposit_*", async () => {
    const chain = makeChain({ data: DEPOSIT_ROW, error: null });
    fromMock.mockReturnValue(chain);
    const { result } = renderWithClient(() => useUpdateService());

    await result.current.mutateAsync({
      id: BASE_ROW.id,
      name: "Corte",
      durationMinutes: 30,
      processingMinutes: 0,
      priceCents: 10000,
      backbarCostCents: 0,
      active: true,
      deposit: {
        enabled: false,
        type: null,
        value: 0,
        deadlineHours: 24,
        refundPolicy: "none",
        refundPercent: null,
      },
    });

    expect(chain.update).toHaveBeenCalledWith(
      expect.objectContaining({ deposit_enabled: false }),
    );
  });
});
