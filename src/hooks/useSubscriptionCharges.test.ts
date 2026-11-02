// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  SUBSCRIPTION_CHARGES_KEY,
  useSubscriptionCharges,
  useCreateSubscriptionCharge,
  subscriptionChargeRowSchema,
} from "@/hooks/useSubscriptionCharges";

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
  id: "sc-1",
  tenant_id: "t-1",
  asaas_payment_id: "pay-1",
  status: "pendente",
  amount_cents: 9900,
  plan: "individual",
  billing_period: "monthly",
  pix_qr_code: "qr",
  pix_copy_paste: "code",
  expires_at: "2026-12-01T00:00:00.000Z",
  paid_at: null,
  created_at: "2026-11-01T00:00:00.000Z",
};

function makeQuery(data: unknown, error: unknown = null) {
  const q: any = {};
  q.select = () => q;
  q.order = () => q;
  q.then = (resolve: (v: unknown) => unknown) =>
    Promise.resolve({ data, error }).then(resolve);
  return q;
}

beforeEach(() => {
  fromMock.mockReset();
  invokeMock.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("useSubscriptionCharges", () => {
  it("lê subscription_charges sob RLS e valida com zod", async () => {
    fromMock.mockReturnValue(makeQuery([ROW]));

    const { result } = renderWithClient(() => useSubscriptionCharges());
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(fromMock).toHaveBeenCalledWith("subscription_charges");
    expect(result.current.data).toHaveLength(1);
    expect(() => subscriptionChargeRowSchema.parse(ROW)).not.toThrow();
  });

  it("lança em erro do PostgREST", async () => {
    fromMock.mockReturnValue(makeQuery(null, { message: "rls" }));

    const { result } = renderWithClient(() => useSubscriptionCharges());
    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});

describe("useCreateSubscriptionCharge", () => {
  it("invoca create-subscription-charge e invalida cache", async () => {
    invokeMock.mockResolvedValue({
      data: { charge_id: "sc-2", pix_qr_code: "qr", pix_copy_paste: "code", expires_at: "2026-12-02T00:00:00.000Z" },
      error: null,
    });

    const { result, queryClient } = renderWithClient(() => useCreateSubscriptionCharge());
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    await act(async () => {
      await result.current.mutateAsync({
        tenant_id: "11111111-2222-3333-4444-555555555555",
        plan: "individual",
        billing_period: "monthly",
      });
    });

    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock.mock.calls[0]?.[0]).toBe("create-subscription-charge");
    expect(invokeMock.mock.calls[0]?.[1]).toMatchObject({
      body: {
        tenant_id: "11111111-2222-3333-4444-555555555555",
        plan: "individual",
        billing_period: "monthly",
      },
    });
    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: SUBSCRIPTION_CHARGES_KEY }),
    );
  });

  it("propaga erro do invoke", async () => {
    invokeMock.mockResolvedValue({ data: null, error: { message: "forbidden" } });

    const { result } = renderWithClient(() => useCreateSubscriptionCharge());
    await expect(
      result.current.mutateAsync({
        tenant_id: "11111111-2222-3333-4444-555555555555",
        plan: "individual",
        billing_period: "monthly",
      }),
    ).rejects.toBeTruthy();
  });
});