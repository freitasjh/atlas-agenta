// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  CHARGES_KEY,
  useCharges,
  useCreateCharge,
  chargeRowSchema,
} from "@/hooks/useCharges";
import { SETTLEMENT_KEY } from "@/hooks/useAppointmentPayments";

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
  id: "c-1",
  tenant_id: "t-1",
  appointment_id: "a-1",
  asaas_payment_id: "pay-1",
  status: "pendente",
  amount_cents: 10000,
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
  q.eq = () => q;
  q.gte = () => q;
  q.lte = () => q;
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

describe("useCharges", () => {
  it("lê charges sob RLS e valida com zod", async () => {
    fromMock.mockReturnValue(makeQuery([ROW]));

    const { result } = renderWithClient(() => useCharges());
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(fromMock).toHaveBeenCalledWith("charges");
    expect(result.current.data).toHaveLength(1);
    expect(() => chargeRowSchema.parse(ROW)).not.toThrow();
  });

  it("lança em erro do PostgREST", async () => {
    fromMock.mockReturnValue(makeQuery(null, { message: "rls" }));

    const { result } = renderWithClient(() => useCharges());
    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});

describe("useCreateCharge", () => {
  it("invoca create-charge com {appointment_id} e invalida cache", async () => {
    invokeMock.mockResolvedValue({
      data: { charge_id: "c-2", pix_qr_code: "qr", pix_copy_paste: "code", expires_at: "2026-12-02T00:00:00.000Z" },
      error: null,
    });

    const { result, queryClient } = renderWithClient(() => useCreateCharge());
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    await act(async () => {
      await result.current.mutateAsync({ appointment_id: "a-1" });
    });

    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock.mock.calls[0]?.[0]).toBe("create-charge");
    expect(invokeMock.mock.calls[0]?.[1]).toMatchObject({
      body: { appointment_id: "a-1" },
    });
    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: CHARGES_KEY }),
    );
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: SETTLEMENT_KEY });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["agenda-payment-flags"],
    });
  });

  it("normaliza erro do invoke em PaymentApiError (código estável)", async () => {
    invokeMock.mockResolvedValue({
      data: null,
      error: { code: "FORBIDDEN", status: 403 },
    });

    const { result } = renderWithClient(() => useCreateCharge());
    await expect(
      result.current.mutateAsync({ appointment_id: "a-1" }),
    ).rejects.toMatchObject({
      name: "PaymentApiError",
      code: "FORBIDDEN",
    });
  });

  it("propaga erro do invoke", async () => {
    invokeMock.mockResolvedValue({ data: null, error: { message: "forbidden" } });

    const { result } = renderWithClient(() => useCreateCharge());
    await expect(
      result.current.mutateAsync({ appointment_id: "a-1" }),
    ).rejects.toBeTruthy();
  });

  it("input novo com amount envia appointment_id, amount_cents e idempotency_key", async () => {
    invokeMock.mockResolvedValue({
      data: { charge_id: "c-3", amount_cents: 3000, pix_qr_code: null },
      error: null,
    });
    const { result } = renderWithClient(() => useCreateCharge());

    await act(async () => {
      await result.current.mutateAsync({
        appointmentId: "a-1",
        amountCents: 3000,
        idempotencyKey: "key-3",
      });
    });

    expect(invokeMock.mock.calls[0]?.[1]).toEqual({
      body: {
        appointment_id: "a-1",
        amount_cents: 3000,
        idempotency_key: "key-3",
      },
    });
  });

  it("aceita snake_case com amount", async () => {
    invokeMock.mockResolvedValue({
      data: { charge_id: "c-4", amount_cents: 2000 },
      error: null,
    });
    const { result } = renderWithClient(() => useCreateCharge());
    await act(async () => {
      await result.current.mutateAsync({
        appointment_id: "a-2",
        amount_cents: 2000,
        idempotency_key: "key-4",
      });
    });
    expect(invokeMock.mock.calls[0]?.[1]).toEqual({
      body: {
        appointment_id: "a-2",
        amount_cents: 2000,
        idempotency_key: "key-4",
      },
    });
  });

  it("legado sem amount mantém o body {appointment_id}", async () => {
    invokeMock.mockResolvedValue({
      data: { charge_id: "c-5" },
      error: null,
    });
    const { result } = renderWithClient(() => useCreateCharge());
    await act(async () => {
      await result.current.mutateAsync({ appointment_id: "a-3" });
    });
    expect(invokeMock.mock.calls[0]?.[1]).toEqual({
      body: { appointment_id: "a-3" },
    });
  });

  it("amountCents=0 falha antes do invoke", async () => {
    const { result } = renderWithClient(() => useCreateCharge());
    await expect(
      result.current.mutateAsync({ appointmentId: "a-1", amountCents: 0 }),
    ).rejects.toBeTruthy();
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("normaliza charge_id → id", async () => {
    invokeMock.mockResolvedValue({
      data: {
        charge_id: "c-6",
        amount_cents: 3000,
        pix_qr_code: "qr",
        expires_at: "2026-12-01T00:00:00.000Z",
      },
      error: null,
    });
    const { result } = renderWithClient(() => useCreateCharge());
    await act(async () => {
      const response = await result.current.mutateAsync({
        appointmentId: "a-1",
        amountCents: 3000,
        idempotencyKey: "key-6",
      });
      expect(response.id).toBe("c-6");
      expect(response.pix_qr_code).toBe("qr");
    });
  });
});