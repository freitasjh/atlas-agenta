import { useCallback } from "react";

import { useSendMessage } from "@/hooks/useMessages";
import { useMessageTemplates } from "@/hooks/useMessageTemplates";
import { shouldAutoSendConfirmation } from "@/lib/confirmation-gating";
import type { AppointmentWithRelations } from "@/types/domain";

/** Resultado do consumo T2.0: `sent` | `skipped` (silencioso) | `failed`. */
export type AutoSendOutcome = "sent" | "skipped" | "failed";

/**
 * Consumo T2.0 (ADR-07): confirmar 1-clique dispara a régua WhatsApp existente
 * (`useSendMessage`, template `confirmacao`) **se** opt-in + toggle ligado +
 * janela 24h; fora disso, silencioso. Falha de envio nunca propaga (o status
 * já mudou) — o chamador decide o toast pelo `outcome`.
 */
export function useAutoSendConfirmation() {
  const sendMessage = useSendMessage();
  const templatesQuery = useMessageTemplates();

  const maybeSendConfirmation = useCallback(
    async (
      appointment: AppointmentWithRelations,
      nowMs: number = Date.now(),
    ): Promise<AutoSendOutcome> => {
      const row = templatesQuery.data?.find(
        (template) => template.template_key === "confirmacao",
      );
      // Ausente = não configurado = ligado (mesmo default da tela de modelos).
      const templateActive = row ? row.active : true;
      const canSend = shouldAutoSendConfirmation({
        optIn: appointment.customers?.whatsapp_opt_in ?? false,
        templateActive,
        startsAtIso: appointment.starts_at,
        nowMs,
      });
      if (!canSend || !appointment.customer_id) return "skipped";
      try {
        await sendMessage.mutateAsync({
          template: "confirmacao",
          customerId: appointment.customer_id,
          appointmentId: appointment.id,
        });
        return "sent";
      } catch {
        return "failed";
      }
    },
    [sendMessage, templatesQuery.data],
  );

  return { maybeSendConfirmation };
}
