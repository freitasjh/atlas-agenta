import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";

import { supabase } from "@/lib/supabase";
import { toPaymentApiError, type PaymentApiError } from "@/lib/payment-errors";
import { SETTLEMENT_KEY } from "@/hooks/useAppointmentPayments";

/**
 * Hooks de dados das cobranças PIX do tenant (ADR-20). Leitura sob RLS;
 * criação via Edge Function `create-charge` (operação privilegiada).
 */

export const CHARGE_STATUSES = ["pendente", "pago", "expirado", "cancelado"] as const;
export type ChargeStatus = (typeof CHARGE_STATUSES)[number];

export const chargeRowSchema = z.object({
  id: z.string(),
  tenant_id: z.string(),
  appointment_id: z.string().nullable(),
  asaas_payment_id: z.string().nullable(),
  status: z.enum(CHARGE_STATUSES),
  amount_cents: z.number(),
  pix_qr_code: z.string().nullable(),
  pix_copy_paste: z.string().nullable(),
  expires_at: z.string().nullable(),
  paid_at: z.string().nullable(),
  created_at: z.string(),
});

export type Charge = z.infer<typeof chargeRowSchema>;

export const chargeListSchema = z.array(chargeRowSchema);

export const CHARGES_KEY = ["charges"] as const;

const CHARGES_SELECT =
  "id, tenant_id, appointment_id, asaas_payment_id, status, amount_cents, pix_qr_code, pix_copy_paste, expires_at, paid_at, created_at";

export type ChargeFilters = {
  status?: ChargeStatus | "todos";
  from?: string;
  to?: string;
};

export function useCharges(filters?: ChargeFilters) {
  const f = filters ?? {};
  return useQuery<Charge[]>({
    queryKey: [...CHARGES_KEY, f],
    queryFn: async () => {
      let query = supabase
        .from("charges")
        .select(CHARGES_SELECT)
        .order("created_at", { ascending: false });
      if (f.status && f.status !== "todos") {
        query = query.eq("status", f.status);
      }
      if (f.from) query = query.gte("created_at", f.from);
      if (f.to) query = query.lte("created_at", f.to);
      const { data, error } = await query;
      if (error) throw error;
      return chargeListSchema.parse(data ?? []);
    },
  });
}

export const createChargeInputSchema = z.object({
  appointment_id: z.string().min(1).optional(),
  appointmentId: z.string().min(1).optional(),
  amountCents: z.number().int().positive().optional(),
  amount_cents: z.number().int().positive().optional(),
  idempotencyKey: z.string().min(1).optional(),
  idempotency_key: z.string().min(1).optional(),
});

/**
 * Entrada do `create-charge` (ADR-003/ADR-004). Aceita camelCase (novo) e
 * snake_case (compat) para a janela de rollout. Quando `amountCents`/
 * `amount_cents` está presente, o body leva a parcela + `idempotency_key`;
 * sem amount, mantém o contrato legado `{ appointment_id }` (RNF-11).
 */
export interface CreateChargeInput {
  appointmentId?: string;
  appointment_id?: string;
  amountCents?: number;
  amount_cents?: number;
  idempotencyKey?: string;
  idempotency_key?: string;
}

export const createChargeResponseSchema = z
  .object({
    charge_id: z.string(),
    amount_cents: z.number().int().optional(),
    pix_qr_code: z.string().nullable().optional(),
    pix_copy_paste: z.string().nullable().optional(),
    expires_at: z.string().nullable().optional(),
    reused: z.boolean().optional(),
  })
  .passthrough();

/** Cobrança normalizada (`charge_id` → `id`) para consumo da UI. */
export interface CreateChargeResponse {
  id: string;
  amount_cents: number;
  pix_qr_code: string | null;
  pix_copy_paste: string | null;
  expires_at: string | null;
  reused: boolean;
}

export function useCreateCharge() {
  const queryClient = useQueryClient();
  return useMutation<
    CreateChargeResponse,
    PaymentApiError,
    CreateChargeInput
  >({
    mutationFn: async (input: CreateChargeInput): Promise<CreateChargeResponse> => {
      const appointmentId = input.appointmentId ?? input.appointment_id;
      if (!appointmentId) throw new Error("appointment_id obrigatório.");

      const amountCents = input.amountCents ?? input.amount_cents;
      const body: Record<string, unknown> = { appointment_id: appointmentId };

      if (amountCents !== undefined) {
        if (!Number.isInteger(amountCents) || amountCents <= 0) {
          throw new Error("amount_cents inválido.");
        }
        body.amount_cents = amountCents;
        body.idempotency_key =
          input.idempotencyKey ?? input.idempotency_key ?? crypto.randomUUID();
      }

      const { data, error } = await supabase.functions.invoke("create-charge", {
        body,
      });
      if (error) throw await toPaymentApiError(error);
      const parsed = createChargeResponseSchema.parse(data);
      return {
        id: parsed.charge_id,
        amount_cents: parsed.amount_cents ?? amountCents ?? 0,
        pix_qr_code: parsed.pix_qr_code ?? null,
        pix_copy_paste: parsed.pix_copy_paste ?? null,
        expires_at: parsed.expires_at ?? null,
        reused: parsed.reused ?? false,
      };
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: CHARGES_KEY });
      void queryClient.invalidateQueries({ queryKey: SETTLEMENT_KEY });
      void queryClient.invalidateQueries({ queryKey: ["agenda-payment-flags"] });
    },
  });
}