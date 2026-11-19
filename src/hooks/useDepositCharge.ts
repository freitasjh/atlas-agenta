import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/lib/supabase";
import { PaymentApiError, toPaymentApiError } from "@/lib/payment-errors";
import {
  settlementSchema,
} from "@/hooks/useAppointmentPayments";
import type { AppointmentSettlement } from "@/types/payments";
import type { DepositCharge } from "@/lib/validations/deposit";

export const DEPOSIT_CHARGE_KEY = ["deposit-charge"] as const;

/**
 * Charge de depósito do atendimento (Fase 4, ADR-12 / PRD RF-06).
 *
 * Lê via `get-appointment-settlement` — Edge escopada ao atendimento sob RBAC
 * (a trava real é o servidor: `professional` só lê a própria agenda,
 * `receptionist` nunca recebe o QR quando `can_view_qr=false`). Para um
 * atendimento `aguardando_deposito`, a pendente ativa É a cobrança do depósito
 * (índice parcial: no máximo 1 `deposito` pendente por atendimento).
 *
 * Sem pendente ativa → `null` (o drawer mostra a dica, nunca painel vazio).
 * Polling de status em tempo real é follow-up 🟡 (hoje: refetch no reenviar +
 * ao abrir o drawer).
 */
export function useDepositCharge(appointmentId: string | null) {
  return useQuery<DepositCharge | null, PaymentApiError>({
    queryKey: [...DEPOSIT_CHARGE_KEY, appointmentId],
    enabled: appointmentId !== null,
    staleTime: 0,
    networkMode: "always",
    retry: false,
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke(
        "get-appointment-settlement",
        { body: { appointment_id: appointmentId } },
      );
      if (error) throw await toPaymentApiError(error);
      const parsed = settlementSchema.safeParse(data);
      if (!parsed.success) throw new PaymentApiError("INVALID_RESPONSE");
      const settlement = parsed.data as AppointmentSettlement;
      const pending = settlement.pending_charges[0];
      if (!pending) return null;
      return {
        id: pending.id,
        status: "pendente",
        amountCents: pending.amount_cents,
        pixQrCode: pending.pix_qr_code,
        pixCopiaECola: pending.pix_copy_paste,
        expiresAt: pending.expires_at,
      } satisfies DepositCharge;
    },
  });
}
