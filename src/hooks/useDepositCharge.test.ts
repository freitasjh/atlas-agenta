// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useDepositCharge } from "@/hooks/useDepositCharge";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));

vi.mock("@/lib/supabase", () => ({
  supabase: { functions: { invoke: invokeMock } },
}));

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

const SETTLEMENT = {
  appointment: {
    id: "ap-1",
    status: "aguardando_deposito",
    starts_at: "2026-11-10T12:00:00.000Z",
    customer_name: "Ana",
    service_name: "Corte",
    professional_name: "Bia",
    total_cents: 10000,
  },
  payments: [],
  pending_charges: [
    {
      id: "ch-1",
      amount_cents: 3000,
      expires_at: "2026-11-11T12:00:00.000Z",
      pix_qr_code: "qr-data",
      pix_copy_paste: "pix-code",
    },
  ],
  stale_charges: [],
  total_paid_cents: 0,
  tip_cents: 0,
  reserved_cents: 3000,
  remaining_cents: 10000,
  payment_status: "aguardando_pix",
  permissions: {
    can_register: false,
    can_cancel_charge: true,
    can_confirm_manual: false,
    can_void: false,
    can_view_qr: true,
    can_reissue_pix: true,
  },
};

beforeEach(() => {
  invokeMock.mockReset();
});

afterEach(cleanup);

describe("useDepositCharge — ADR-12 / RF-06", () => {
  it("mapeia a primeira charge pendente do settlement para DepositCharge", async () => {
    invokeMock.mockResolvedValue({ data: SETTLEMENT, error: null });
    const { result } = renderWithClient(() => useDepositCharge("ap-1"));

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(invokeMock.mock.calls[0]?.[0]).toBe("get-appointment-settlement");
    expect(invokeMock.mock.calls[0]?.[1]).toEqual({
      body: { appointment_id: "ap-1" },
    });
    expect(result.current.data).toEqual({
      id: "ch-1",
      status: "pendente",
      amountCents: 3000,
      pixQrCode: "qr-data",
      pixCopiaECola: "pix-code",
      expiresAt: "2026-11-11T12:00:00.000Z",
    });
  });

  it("sem charge pendente: data null (drawer mostra dica)", async () => {
    invokeMock.mockResolvedValue({
      data: { ...SETTLEMENT, pending_charges: [] },
      error: null,
    });
    const { result } = renderWithClient(() => useDepositCharge("ap-1"));

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toBeNull();
  });

  it("sem appointmentId: não dispara request (drawer fechado/outro status)", async () => {
    const { result } = renderWithClient(() => useDepositCharge(null));

    expect(result.current.isPending).toBe(true);
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("erro da Edge vira PaymentApiError", async () => {
    invokeMock.mockResolvedValue({
      data: null,
      error: {
        context: new Response(JSON.stringify({ code: "FORBIDDEN" }), {
          status: 403,
        }),
      },
    });
    const { result } = renderWithClient(() => useDepositCharge("ap-1"));

    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(result.current.error?.code).toBe("FORBIDDEN");
  });
});
