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

/**
 * Schema do formulário de edição de template (react-hook-form + resolver zod,
 * ADR-06). `templateKey` no enum fechado; `body` de 1 a 1000 chars — o banco
 * aceita até 2000 (ADR-01), a UI é o limite mais apertado. Mensagens em pt-BR.
 */
export const messageTemplateSchema = z.object({
  templateKey: z.enum(MESSAGE_TEMPLATES, {
    errorMap: () => ({ message: "Selecione um modelo de mensagem." }),
  }),
  body: z
    .string()
    .trim()
    .min(1, "Escreva o texto do modelo.")
    .max(1000, "O texto do modelo é muito longo."),
  active: z.boolean(),
});

export type MessageTemplateInput = z.infer<typeof messageTemplateSchema>;
