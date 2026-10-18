import { z } from "zod";

import { MESSAGE_TEMPLATES } from "@/types/domain";

/**
 * Schema de validação do formulário de envio de mensagem sob demanda
 * (react-hook-form + resolver zod, ADR-08). Espelha o contrato de `send` da
 * Edge Function `whatsapp` (ADR-04): `template` no enum, `customerId` uuid,
 * `appointmentId` uuid opcional. A validação no cliente é UX (feedback pt-BR
 * imediato); a trava real (opt-in, idempotência, tenant) é no servidor.
 * Mensagens em pt-BR.
 */
export const sendMessageSchema = z.object({
  template: z.enum(MESSAGE_TEMPLATES, {
    errorMap: () => ({ message: "Selecione um modelo de mensagem." }),
  }),
  customerId: z.string().uuid("Selecione um cliente."),
  appointmentId: z.string().uuid("Agendamento inválido.").optional(),
});

export type SendMessageInput = z.infer<typeof sendMessageSchema>;
