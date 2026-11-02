import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";

import { supabase } from "@/lib/supabase";

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
});

export type CreateChargeInput = z.infer<typeof createChargeInputSchema>;

export const createChargeResponseSchema = z.object({
  charge_id: z.string(),
  pix_qr_code: z.string().nullable().optional(),
  pix_copy_paste: z.string().nullable().optional(),
  expires_at: z.string().optional(),
});

export function useCreateCharge() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateChargeInput) => {
      const parsed = createChargeInputSchema.parse(input);
      const appointment_id = parsed.appointment_id ?? parsed.appointmentId;
      if (!appointment_id) throw new Error("appointment_id obrigatório.");
      const { data, error } = await supabase.functions.invoke("create-charge", {
        body: { appointment_id },
      });
      if (error) throw error;
      return createChargeResponseSchema.parse(data);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: CHARGES_KEY });
    },
  });
}