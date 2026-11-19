import { useMutation, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";

import { supabase } from "@/lib/supabase";

/**
 * Checkout self-service (Fase 4, ADR-10 G/ADR-18 UI).
 *
 * Contrato espelha `supabase/functions/create-checkout` (dono do contrato):
 * request `{ plan, idempotency_key? }` — **sem `tenant_id`** (servidor deriva
 * do JWT); response `{ kind, pix_qr_code, pix_copy_paste, expires_at,
 * effective_at, replayed? }` (PIX direto, sem URL externa). Toda resposta é
 * dado não confiável: validada por zod antes do uso.
 *
 * `kind=upgrade` tem efeito imediato após confirmação; `kind=downgrade` agenda
 * `effective_at` no fim do ciclo. O status final chega por webhook — a UI faz
 * polling do tenant (`useSelfCheckoutPolling`) enquanto aguarda pagamento.
 */

export const selfCheckoutResponseSchema = z.object({
  id: z.string().optional(),
  kind: z.enum(["upgrade", "downgrade"]),
  pix_qr_code: z.string().nullable().optional(),
  pix_copy_paste: z.string().nullable().optional(),
  expires_at: z.string().nullable().optional(),
  effective_at: z.string().nullable().optional(),
  scheduled: z.boolean().optional(),
  replayed: z.boolean().optional(),
});

export type SelfCheckoutResponse = z.infer<typeof selfCheckoutResponseSchema>;

export const SELF_CHECKOUT_KEY = ["plans", "self-checkout"] as const;

/** Gera a chave de idempotência do retry (uma por tentativa de checkout). */
export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}

export function useCreateSelfCheckout() {
  const queryClient = useQueryClient();
  return useMutation<SelfCheckoutResponse, Error, { plan: string }>({
    mutationFn: async ({ plan }) => {
      const { data, error } = await supabase.functions.invoke(
        "create-checkout",
        {
          body: { plan, idempotency_key: newIdempotencyKey() },
        },
      );
      if (error) throw error;
      return selfCheckoutResponseSchema.parse(data);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["tenant"] });
      void queryClient.invalidateQueries({
        queryKey: ["subscription-charges"],
      });
    },
  });
}
