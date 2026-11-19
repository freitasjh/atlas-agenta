import { useMutation, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";

import { supabase } from "@/lib/supabase";
import { PaymentApiError, toPaymentApiError } from "@/lib/payment-errors";

/**
 * Hook de abertura de venda walk-in (ADR-22): chama a Edge `create-walk-in`
 * (service_role; `tenant_id`/preço/origem do servidor). A conclusão/pagamento
 * segue no checkout existente (`useRegisterAppointmentPayments`).
 * Idempotência: `creationIdempotencyKey` gerada por clique e reusada em retry
 * — mesma chave devolve o existente (`reused: true`).
 */
const createWalkInResponseSchema = z
  .object({
    appointment_id: z.string().uuid(),
    reused: z.boolean(),
  })
  .strict();

export interface CreateWalkInInput {
  professionalId: string;
  selection:
    | { kind: "service"; serviceId: string }
    | { kind: "combo"; comboId: string }
    | { kind: "product"; productId: string; qty: number };
  customerId?: string | null;
  creationIdempotencyKey: string;
}

export interface CreateWalkInResult {
  appointmentId: string;
  reused: boolean;
}

export function newCreationKey(): string {
  return globalThis.crypto?.randomUUID?.() ?? `walkin-${Date.now()}-${Math.random()}`;
}

export function useCreateWalkIn() {
  const queryClient = useQueryClient();
  return useMutation<CreateWalkInResult, PaymentApiError, CreateWalkInInput>({
    mutationFn: async (input) => {
      const body = {
        professional_id: input.professionalId,
        ...(input.selection.kind === "service"
          ? { service_id: input.selection.serviceId }
          : input.selection.kind === "combo"
            ? { combo_id: input.selection.comboId }
            : { product_id: input.selection.productId, product_qty: input.selection.qty }),
        ...(input.customerId ? { customer_id: input.customerId } : {}),
        creation_idempotency_key: input.creationIdempotencyKey,
      };
      const { data, error } = await supabase.functions.invoke("create-walk-in", { body });
      if (error) throw await toPaymentApiError(error);
      const parsed = createWalkInResponseSchema.safeParse(data);
      if (!parsed.success) throw new PaymentApiError("INVALID_RESPONSE");
      return {
        appointmentId: parsed.data.appointment_id,
        reused: parsed.data.reused,
      };
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["appointments"] });
      void queryClient.invalidateQueries({ queryKey: ["financial-summary"] });
      void queryClient.invalidateQueries({ queryKey: ["agenda-payment-flags"] });
    },
  });
}
