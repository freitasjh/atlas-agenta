import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";

import { supabase } from "@/lib/supabase";

/**
 * Hooks de dados das cobranças de assinatura (super admin) (ADR-20).
 */

export const SUBSCRIPTION_CHARGE_STATUSES = [
  "pendente",
  "pago",
  "expirado",
  "cancelado",
] as const;
export type SubscriptionChargeStatus = (typeof SUBSCRIPTION_CHARGE_STATUSES)[number];

export const subscriptionChargeRowSchema = z.object({
  id: z.string(),
  tenant_id: z.string(),
  asaas_payment_id: z.string().nullable(),
  status: z.enum(SUBSCRIPTION_CHARGE_STATUSES),
  amount_cents: z.number(),
  plan: z.string().nullable(),
  billing_period: z.string().nullable(),
  pix_qr_code: z.string().nullable(),
  pix_copy_paste: z.string().nullable(),
  expires_at: z.string().nullable(),
  paid_at: z.string().nullable(),
  created_at: z.string(),
});

export type SubscriptionCharge = z.infer<typeof subscriptionChargeRowSchema>;

export const subscriptionChargeListSchema = z.array(subscriptionChargeRowSchema);

export const SUBSCRIPTION_CHARGES_KEY = ["subscription-charges"] as const;

const SUBSCRIPTION_CHARGES_SELECT =
  "id, tenant_id, asaas_payment_id, status, amount_cents, plan, billing_period, pix_qr_code, pix_copy_paste, expires_at, paid_at, created_at";

export function useSubscriptionCharges() {
  return useQuery<SubscriptionCharge[]>({
    queryKey: SUBSCRIPTION_CHARGES_KEY,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("subscription_charges")
        .select(SUBSCRIPTION_CHARGES_SELECT)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return subscriptionChargeListSchema.parse(data ?? []);
    },
  });
}

export const createSubscriptionChargeInputSchema = z.object({
  tenant_id: z.string().uuid(),
  plan: z.string().min(1),
  // Não existe plano anual em `PLANS` (sem regra de desconto definida):
  // `annual` é recusado aqui e na Edge Function, em vez de inventar `mensal * 10`.
  billing_period: z.literal("monthly").default("monthly"),
});

export type CreateSubscriptionChargeInput = z.infer<
  typeof createSubscriptionChargeInputSchema
>;

export const createSubscriptionChargeResponseSchema = z.object({
  charge_id: z.string(),
  pix_qr_code: z.string().nullable().optional(),
  pix_copy_paste: z.string().nullable().optional(),
  expires_at: z.string().optional(),
});

export function useCreateSubscriptionCharge() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateSubscriptionChargeInput) => {
      const parsed = createSubscriptionChargeInputSchema.parse(input);
      const { data, error } = await supabase.functions.invoke(
        "create-subscription-charge",
        {
          body: {
            tenant_id: parsed.tenant_id,
            plan: parsed.plan,
            billing_period: parsed.billing_period,
          },
        },
      );
      if (error) throw error;
      return createSubscriptionChargeResponseSchema.parse(data);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: SUBSCRIPTION_CHARGES_KEY,
      });
    },
  });
}