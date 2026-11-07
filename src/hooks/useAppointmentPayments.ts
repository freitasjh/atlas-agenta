import { useRef } from "react";
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { z } from "zod";

import { supabase } from "@/lib/supabase";
import { PaymentApiError, toPaymentApiError } from "@/lib/payment-errors";
import {
  PAYMENT_METHODS,
  PAYMENT_STATUSES,
  type AppointmentSettlement,
  type PaymentMethod,
  type PixCharge,
} from "@/types/payments";
import { APPOINTMENT_STATUSES } from "@/types/domain";

/**
 * Hooks do fechamento de pagamento (ADR-004 §6). Todo transporte vive aqui:
 * componente nunca importa `supabase`. Respostas validadas por zod antes de
 * sair do hook; erros normalizados em `PaymentApiError`.
 */

export const SETTLEMENT_KEY = ["appointment-settlement"] as const;

/**
 * Tetos do settlement. Sem timeout, uma rede "offline" deixa o diálogo em
 * "Carregando pagamento…" indefinidamente (o fetch de loopback não rejeita);
 * estourar o prazo vira `NETWORK` e libera o botão "Tentar novamente".
 */
export const SETTLEMENT_TIMEOUT_MS = 15_000;

function withTimeout<T>(operation: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new PaymentApiError("NETWORK")),
      timeoutMs,
    );
  });
  return Promise.race([operation, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

const paymentRowSchema = z.object({
  id: z.string(),
  method: z.enum(PAYMENT_METHODS),
  amount_cents: z.number().int(),
  tip_cents: z.number().int(),
  source: z.enum(["manual", "asaas"]),
  received_at: z.string(),
  voided_at: z.string().nullable(),
  void_reason: z.string().nullable(),
});

const pendingChargeSchema = z.object({
  id: z.string(),
  amount_cents: z.number().int(),
  expires_at: z.string().nullable(),
  pix_qr_code: z.string().nullable(),
  pix_copy_paste: z.string().nullable(),
});

const staleChargeSchema = z.object({
  id: z.string(),
  amount_cents: z.number().int(),
  status: z.enum(["expirado", "cancelado", "pendente"]),
  expires_at: z.string().nullable(),
});

const permissionsSchema = z.object({
  can_register: z.boolean(),
  can_cancel_charge: z.boolean(),
  can_confirm_manual: z.boolean(),
  can_void: z.boolean(),
  can_view_qr: z.boolean(),
  can_reissue_pix: z.boolean(),
});

export const settlementSchema = z
  .object({
    appointment: z
      .object({
        id: z.string(),
        status: z.enum(APPOINTMENT_STATUSES),
        starts_at: z.string(),
        customer_name: z.string().nullable(),
        service_name: z.string().nullable(),
        professional_name: z.string().nullable(),
        total_cents: z.number().int(),
      })
      .passthrough(),
    payments: z.array(paymentRowSchema),
    pending_charges: z.array(pendingChargeSchema),
    stale_charges: z.array(staleChargeSchema).default([]),
    total_paid_cents: z.number().int(),
    tip_cents: z.number().int(),
    reserved_cents: z.number().int(),
    remaining_cents: z.number().int(),
    payment_status: z.enum(PAYMENT_STATUSES),
    permissions: permissionsSchema,
  })
  .passthrough();

export const pixChargeSchema = z.object({
  id: z.string(),
  amount_cents: z.number().int(),
  pix_qr_code: z.string().nullable(),
  pix_copy_paste: z.string().nullable(),
  expires_at: z.string().nullable(),
});

export const registerResponseSchema = z.object({
  settlement: settlementSchema,
  charge: pixChargeSchema.nullable(),
  replayed: z.boolean().optional().default(false),
});

const cancelResponseSchema = z.object({
  cancelled: z.boolean().optional().default(true),
  replayed: z.boolean().optional().default(false),
  charge_id: z.string().optional(),
  gateway_divergence_risk: z.boolean().optional().default(false),
});

const confirmManualResponseSchema = z.object({
  settlement: settlementSchema.nullable().optional().default(null),
  payment: z.unknown().nullable().optional().default(null),
  replayed: z.boolean().optional().default(false),
});

const voidResponseSchema = z.object({
  settlement: settlementSchema.nullable().optional().default(null),
  refund_required: z.boolean().optional().default(false),
  replayed: z.boolean().optional().default(false),
});

async function invokeEdge<T>(
  name: string,
  body: Record<string, unknown>,
  schema: z.ZodType<T>,
): Promise<T> {
  const { data, error } = await supabase.functions.invoke(name, { body });
  if (error) throw await toPaymentApiError(error);
  const parsed = schema.safeParse(data);
  if (!parsed.success) throw new PaymentApiError("INVALID_RESPONSE");
  return parsed.data;
}

function invalidatePaymentQueries(
  queryClient: QueryClient,
  appointmentId: string | null,
): void {
  if (appointmentId) {
    void queryClient.invalidateQueries({
      queryKey: [...SETTLEMENT_KEY, appointmentId],
    });
  } else {
    void queryClient.invalidateQueries({ queryKey: SETTLEMENT_KEY });
  }
  void queryClient.invalidateQueries({ queryKey: ["appointments"] });
  void queryClient.invalidateQueries({ queryKey: ["charges"] });
  void queryClient.invalidateQueries({ queryKey: ["financial-summary"] });
  void queryClient.invalidateQueries({ queryKey: ["agenda-payment-flags"] });
}

export interface UseAppointmentSettlementOptions {
  enabled?: boolean;
  poll?: boolean;
  /** Orçamento do GET antes de virar `NETWORK` (default 15 s). */
  timeoutMs?: number;
}

export function useAppointmentSettlement(
  appointmentId: string | null,
  options: UseAppointmentSettlementOptions = {},
) {
  const enabled = (options.enabled ?? true) && appointmentId !== null;
  const poll = options.poll ?? false;
  const timeoutMs = options.timeoutMs ?? SETTLEMENT_TIMEOUT_MS;
  // Início da janela de polling: 5 s no primeiro minuto, 10 s depois.
  // Reinicia quando o atendimento em foco muda (o diálogo troca de alvo).
  const startedAtRef = useRef<{ id: string | null; at: number }>({
    id: appointmentId,
    at: Date.now(),
  });
  if (startedAtRef.current.id !== appointmentId) {
    startedAtRef.current = { id: appointmentId, at: Date.now() };
  }

  return useQuery<AppointmentSettlement, PaymentApiError>({
    queryKey: [...SETTLEMENT_KEY, appointmentId],
    enabled,
    staleTime: 0,
    // `online` (padrão) PAUSA a query quando `navigator.onLine === false`: o
    // `queryFn` — e o `withTimeout` abaixo — nunca iniciam e o diálogo fica em
    // "Carregando pagamento…" para sempre. `always` despacha o fetch mesmo
    // offline; a rede rejeita rápido e o teto de 15 s vira `NETWORK`, liberando
    // "Tentar novamente".
    networkMode: "always",
    // Timeout já gastou o orçamento da primeira tentativa e o diálogo oferece
    // "Tentar novamente" explícito: retry silencioso só dobraria o spinner.
    retry: false,
    queryFn: async () => {
      const { data, error } = await withTimeout(
        supabase.functions.invoke("get-appointment-settlement", {
          body: { appointment_id: appointmentId },
        }),
        timeoutMs,
      );
      if (error) throw await toPaymentApiError(error);
      const parsed = settlementSchema.safeParse(data);
      if (!parsed.success) throw new PaymentApiError("INVALID_RESPONSE");
      return parsed.data as AppointmentSettlement;
    },
    refetchInterval: (query) => {
      if (!poll) return false;
      if (query.state.data?.payment_status === "quitado") return false;
      return Date.now() - startedAtRef.current.at < 60_000 ? 5_000 : 10_000;
    },
  });
}

export interface RegisterPaymentsInput {
  appointmentId: string;
  idempotencyKey: string;
  closeAppointment: boolean;
  payments: Array<{ method: PaymentMethod; amountCents: number; tipCents: number }>;
}

export interface RegisterPaymentsResponse {
  settlement: AppointmentSettlement;
  charge: PixCharge | null;
  replayed: boolean;
}

export function useRegisterAppointmentPayments() {
  const queryClient = useQueryClient();
  return useMutation<RegisterPaymentsResponse, PaymentApiError, RegisterPaymentsInput>({
    mutationFn: async (input) => {
      const body = {
        appointment_id: input.appointmentId,
        idempotency_key: input.idempotencyKey,
        close_appointment: input.closeAppointment,
        payments: input.payments.map((payment) => ({
          method: payment.method,
          amount_cents: payment.amountCents,
          tip_cents: payment.tipCents,
        })),
      };
      const result = await invokeEdge(
        "register-appointment-payments",
        body,
        registerResponseSchema,
      );
      return {
        settlement: result.settlement as AppointmentSettlement,
        charge: result.charge as PixCharge | null,
        replayed: result.replayed ?? false,
      };
    },
    onSuccess: (result, input) => {
      invalidatePaymentQueries(
        queryClient,
        input.appointmentId || result.settlement.appointment.id,
      );
    },
    onError: (error, input) => {
      // O servidor pode fechar o atendimento mesmo quando o gateway falha no
      // meio do lote (ex.: 422 GATEWAY_ERROR depois do `concluido`). Sem
      // invalidar no erro, a agenda segue exibindo "Em atendimento" até um
      // reload. Defesa restrita a erro com settlement já concluído.
      if (error.settlement?.appointment.status !== "concluido") return;
      if (
        error.code !== "GATEWAY_ERROR" &&
        error.code !== "GATEWAY_IN_PROGRESS" &&
        error.code !== "GATEWAY_CANCEL_FAILED"
      ) {
        return;
      }
      invalidatePaymentQueries(queryClient, input.appointmentId);
    },
  });
}

export interface CancelChargeResponse {
  cancelled: boolean;
  replayed: boolean;
  chargeId: string | null;
  gatewayDivergenceRisk: boolean;
}

export function useCancelCharge() {
  const queryClient = useQueryClient();
  return useMutation<
    CancelChargeResponse,
    PaymentApiError,
    { chargeId: string; force?: boolean }
  >({
    mutationFn: async (input) => {
      const result = await invokeEdge(
        "cancel-charge",
        { charge_id: input.chargeId, force: input.force ?? false },
        cancelResponseSchema,
      );
      return {
        cancelled: result.cancelled ?? true,
        replayed: result.replayed ?? false,
        chargeId: result.charge_id ?? input.chargeId,
        gatewayDivergenceRisk: result.gateway_divergence_risk ?? false,
      };
    },
    onSuccess: () => invalidatePaymentQueries(queryClient, null),
  });
}

export interface ConfirmManualResponse {
  settlement: AppointmentSettlement | null;
  replayed: boolean;
}

export function useConfirmManualCharge() {
  const queryClient = useQueryClient();
  return useMutation<
    ConfirmManualResponse,
    PaymentApiError,
    { chargeId: string }
  >({
    mutationFn: async (input) => {
      const result = await invokeEdge(
        "confirm-charge-manual",
        { charge_id: input.chargeId },
        confirmManualResponseSchema,
      );
      return {
        settlement: (result.settlement as AppointmentSettlement | null) ?? null,
        replayed: result.replayed ?? false,
      };
    },
    onSuccess: (result) =>
      invalidatePaymentQueries(
        queryClient,
        result.settlement?.appointment.id ?? null,
      ),
  });
}

export interface VoidPaymentResponse {
  settlement: AppointmentSettlement | null;
  refundRequired: boolean;
  replayed: boolean;
}

export function useVoidAppointmentPayment() {
  const queryClient = useQueryClient();
  return useMutation<
    VoidPaymentResponse,
    PaymentApiError,
    { paymentId: string; reason: string }
  >({
    mutationFn: async (input) => {
      const result = await invokeEdge(
        "void-appointment-payment",
        { payment_id: input.paymentId, reason: input.reason },
        voidResponseSchema,
      );
      return {
        settlement: (result.settlement as AppointmentSettlement | null) ?? null,
        refundRequired: result.refund_required ?? false,
        replayed: result.replayed ?? false,
      };
    },
    onSuccess: (result) =>
      invalidatePaymentQueries(
        queryClient,
        result.settlement?.appointment.id ?? null,
      ),
  });
}
