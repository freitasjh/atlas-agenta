// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider, onlineManager } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PaymentApiError } from "@/lib/payment-errors";
import {
  SETTLEMENT_KEY,
  useAppointmentSettlement,
  useCancelCharge,
  useConfirmManualCharge,
  useRegisterAppointmentPayments,
  useVoidAppointmentPayment,
} from "@/hooks/useAppointmentPayments";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));

vi.mock("@/lib/supabase", () => ({
  supabase: { functions: { invoke: invokeMock } },
}));

const { fromMock } = vi.hoisted(() => ({ fromMock: vi.fn() }));
void fromMock;

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
    status: "concluido",
    starts_at: "2026-11-06T12:00:00.000Z",
    customer_name: "Ana",
    service_name: "Corte",
    professional_name: "Bia",
    total_cents: 10000,
  },
  payments: [
    {
      id: "p-1",
      method: "dinheiro",
      amount_cents: 6000,
      tip_cents: 0,
      source: "manual",
      received_at: "2026-11-06T12:30:00.000Z",
      voided_at: null,
      void_reason: null,
    },
  ],
  pending_charges: [
    {
      id: "ch-1",
      amount_cents: 4000,
      expires_at: "2026-11-09T12:00:00.000Z",
      pix_qr_code: "qr",
      pix_copy_paste: "code",
    },
  ],
  stale_charges: [
    {
      id: "ch-0",
      amount_cents: 5000,
      status: "expirado",
      expires_at: "2026-11-05T12:00:00.000Z",
    },
  ],
  total_paid_cents: 6000,
  tip_cents: 0,
  reserved_cents: 4000,
  remaining_cents: 0,
  payment_status: "aguardando_pix",
  permissions: {
    can_register: true,
    can_cancel_charge: true,
    can_confirm_manual: true,
    can_void: true,
    can_view_qr: true,
    can_reissue_pix: true,
  },
};

beforeEach(() => {
  invokeMock.mockReset();
});

afterEach(() => {
  onlineManager.setOnline(true);
  cleanup();
});

describe("useAppointmentSettlement", () => {
  it("chama get-appointment-settlement com { appointment_id } e valida o payload", async () => {
    invokeMock.mockResolvedValue({ data: SETTLEMENT, error: null });
    const { result } = renderWithClient(() =>
      useAppointmentSettlement("ap-1"),
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(invokeMock.mock.calls[0]?.[0]).toBe("get-appointment-settlement");
    expect(invokeMock.mock.calls[0]?.[1]).toEqual({
      body: { appointment_id: "ap-1" },
    });
    expect(result.current.data?.stale_charges).toHaveLength(1);
    expect(result.current.data?.permissions.can_reissue_pix).toBe(true);
  });

  it("403 vira PaymentApiError FORBIDDEN", async () => {
    invokeMock.mockResolvedValue({
      data: null,
      error: {
        context: new Response(JSON.stringify({ code: "PROFESSIONAL_NOT_OWNER" }), {
          status: 403,
        }),
      },
    });
    const { result } = renderWithClient(() =>
      useAppointmentSettlement("ap-1"),
    );
    await waitFor(() => expect(result.current.isError).toBe(true));
    const error = result.current.error as PaymentApiError;
    expect(error).toBeInstanceOf(PaymentApiError);
    expect(error.code).toBe("PROFESSIONAL_NOT_OWNER");
    expect(error.info.messageKey).toBe("payments.error.forbidden");
  });

  it("não dispara quando appointmentId é null", () => {
    const { result } = renderWithClient(() =>
      useAppointmentSettlement(null),
    );
    expect(result.current.fetchStatus).toBe("idle");
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("polling usa 5s e para em quitado/desligado", async () => {
    invokeMock.mockResolvedValue({ data: SETTLEMENT, error: null });
    const { queryClient } = renderWithClient(() =>
      useAppointmentSettlement("ap-1", { poll: true }),
    );
    await waitFor(() =>
      expect(queryClient.getQueryData([...SETTLEMENT_KEY, "ap-1"])).toBeTruthy(),
    );
    const query = queryClient.getQueryCache().find({
      queryKey: [...SETTLEMENT_KEY, "ap-1"],
    });
    const interval = (query?.options as { refetchInterval?: (q: unknown) => unknown })?.refetchInterval as (q: unknown) => unknown;
    expect(interval({ state: { data: SETTLEMENT } })).toBe(5000);
    expect(
      interval({
        state: { data: { ...SETTLEMENT, payment_status: "quitado" } },
      }),
    ).toBe(false);
  });

  it("timeout do settlement vira NETWORK e libera o retry", async () => {
    invokeMock.mockReturnValue(new Promise(() => {}));
    const { result } = renderWithClient(() =>
      useAppointmentSettlement("ap-1", { timeoutMs: 10 }),
    );
    expect(result.current.isLoading).toBe(true);

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect((result.current.error as PaymentApiError).code).toBe("NETWORK");
  });

  it("despacha o settlement mesmo offline (networkMode always)", async () => {
    // Reproduz a falha do QA: com `navigator.onLine === false` o padrão
    // `online` do React Query pausa a query, então o `queryFn` e o
    // `withTimeout` nunca rodam. `always` obriga o fetch a ser tentado.
    onlineManager.setOnline(false);
    invokeMock.mockResolvedValue({ data: SETTLEMENT, error: null });

    const { result, queryClient } = renderWithClient(() =>
      useAppointmentSettlement("ap-1"),
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(invokeMock).toHaveBeenCalledTimes(1);
    const query = queryClient.getQueryCache().find({
      queryKey: [...SETTLEMENT_KEY, "ap-1"],
    });
    expect(query?.options.networkMode).toBe("always");
  });

  it("timeout dispara sob offline em vez de ficar pausado", async () => {
    onlineManager.setOnline(false);
    invokeMock.mockReturnValue(new Promise(() => {}));

    const { result } = renderWithClient(() =>
      useAppointmentSettlement("ap-1", { timeoutMs: 10 }),
    );

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect((result.current.error as PaymentApiError).code).toBe("NETWORK");
    expect(result.current.fetchStatus).not.toBe("paused");
  });

  it("sem poll não agenda refetch", () => {
    const { queryClient } = renderWithClient(() =>
      useAppointmentSettlement("ap-1"),
    );
    const query = queryClient.getQueryCache().find({
      queryKey: [...SETTLEMENT_KEY, "ap-1"],
    });
    const interval = (query?.options as { refetchInterval?: (q: unknown) => unknown })?.refetchInterval as (q: unknown) => unknown;
    expect(interval({ state: { data: SETTLEMENT } })).toBe(false);
  });
});

describe("useRegisterAppointmentPayments", () => {
  it("converte camelCase → snake_case e envia close_appointment", async () => {
    invokeMock.mockResolvedValue({
      data: { settlement: SETTLEMENT, charge: null, replayed: false },
      error: null,
    });
    const { result, queryClient } = renderWithClient(() =>
      useRegisterAppointmentPayments(),
    );
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    await act(async () => {
      await result.current.mutateAsync({
        appointmentId: "ap-1",
        idempotencyKey: "key-1",
        closeAppointment: true,
        payments: [{ method: "dinheiro", amountCents: 10000, tipCents: 500 }],
      });
    });

    expect(invokeMock.mock.calls[0]?.[0]).toBe("register-appointment-payments");
    expect(invokeMock.mock.calls[0]?.[1]).toEqual({
      body: {
        appointment_id: "ap-1",
        idempotency_key: "key-1",
        close_appointment: true,
        payments: [{ method: "dinheiro", amount_cents: 10000, tip_cents: 500 }],
      },
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: [...SETTLEMENT_KEY, "ap-1"],
    });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["appointments"] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["charges"] });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["financial-summary"],
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["agenda-payment-flags"],
    });
  });

  it("GATEWAY_ERROR concluído invalida agenda mesmo com a mutation falhando", async () => {
    invokeMock.mockResolvedValue({
      data: null,
      error: {
        context: new Response(
          JSON.stringify({
            code: "GATEWAY_ERROR",
            settlement: {
              ...SETTLEMENT,
              appointment: {
                ...SETTLEMENT.appointment,
                status: "concluido",
              },
            },
          }),
          { status: 422 },
        ),
      },
    });
    const { result, queryClient } = renderWithClient(() =>
      useRegisterAppointmentPayments(),
    );
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    await act(async () => {
      await expect(
        result.current.mutateAsync({
          appointmentId: "ap-1",
          idempotencyKey: "key-1",
          closeAppointment: true,
          payments: [],
        }),
      ).rejects.toBeInstanceOf(PaymentApiError);
    });

    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: [...SETTLEMENT_KEY, "ap-1"],
    });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["appointments"] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["charges"] });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["agenda-payment-flags"],
    });
  });

  it("normaliza a cobrança devolvida (id)", async () => {
    invokeMock.mockResolvedValue({
      data: {
        settlement: SETTLEMENT,
        charge: {
          id: "ch-9",
          amount_cents: 4000,
          pix_qr_code: "qr",
          pix_copy_paste: "code",
          expires_at: null,
        },
        replayed: false,
      },
      error: null,
    });
    const { result } = renderWithClient(() =>
      useRegisterAppointmentPayments(),
    );
    await act(async () => {
      const response = await result.current.mutateAsync({
        appointmentId: "ap-1",
        idempotencyKey: "key-1",
        closeAppointment: false,
        payments: [],
      });
      expect(response.charge?.id).toBe("ch-9");
    });
  });
});

describe("useCancelCharge / useConfirmManualCharge / useVoidAppointmentPayment", () => {
  it("cancel-charge envia charge_id + force", async () => {
    invokeMock.mockResolvedValue({
      data: { cancelled: true, replayed: false, charge_id: "ch-1" },
      error: null,
    });
    const { result } = renderWithClient(() => useCancelCharge());
    await act(async () => {
      await result.current.mutateAsync({ chargeId: "ch-1", force: true });
    });
    expect(invokeMock.mock.calls[0]).toEqual([
      "cancel-charge",
      { body: { charge_id: "ch-1", force: true } },
    ]);
  });

  it("confirm-charge-manual envia charge_id", async () => {
    invokeMock.mockResolvedValue({
      data: { settlement: SETTLEMENT, payment: null, replayed: false },
      error: null,
    });
    const { result } = renderWithClient(() => useConfirmManualCharge());
    await act(async () => {
      await result.current.mutateAsync({ chargeId: "ch-1" });
    });
    expect(invokeMock.mock.calls[0]).toEqual([
      "confirm-charge-manual",
      { body: { charge_id: "ch-1" } },
    ]);
  });

  it("void-appointment-payment envia payment_id + reason", async () => {
    invokeMock.mockResolvedValue({
      data: { settlement: SETTLEMENT, refund_required: true, replayed: false },
      error: null,
    });
    const { result } = renderWithClient(() => useVoidAppointmentPayment());
    await act(async () => {
      await result.current.mutateAsync({ paymentId: "p-1", reason: "erro" });
    });
    expect(invokeMock.mock.calls[0]).toEqual([
      "void-appointment-payment",
      { body: { payment_id: "p-1", reason: "erro" } },
    ]);
  });
});
