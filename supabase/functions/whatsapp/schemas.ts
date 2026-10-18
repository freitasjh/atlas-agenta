// Schemas zod do payload de entrada e dos DTOs de resposta da Edge Function `whatsapp` — ADR-04.
//
// Payload de invocação é DADO NÃO CONFIÁVEL (RNF-WA-05): validar com zod antes de usar. Qualquer
// `tenant_id` enviado no corpo é IGNORADO — o tenant efetivo vem sempre do JWT/profiles no
// servidor (RNF03, inegociável). O contrato de resposta abaixo é o que a UI (ADR-06) valida com
// zod; se mudar aqui, atualizar os schemas do frontend e os docs de análise.

import { z } from "npm:zod@3.23.8";

/** Templates de mensagem — espelha o enum de `messages.template` (dominio.md). */
export const templateSchema = z.enum([
  "confirmacao",
  "lembrete_d1",
  "cobranca",
  "comprovante",
]);
export type Template = z.infer<typeof templateSchema>;

/** `{ action: 'parear' }` — sem outros campos; tenant_id derivado do JWT. */
export const pairInputSchema = z.object({
  action: z.literal("parear"),
});

/** `{ action: 'enviar', template, customer_id, appointment_id? }`. */
export const sendInputSchema = z.object({
  action: z.literal("enviar"),
  template: templateSchema,
  customer_id: z.string().uuid({ message: "customer_id deve ser um UUID válido." }),
  appointment_id: z
    .string()
    .uuid({ message: "appointment_id deve ser um UUID válido." })
    .optional(),
});

/**
 * Discriminated union por `action`. `.passthrough()` nas variantes não é usado: campos extras
 * (ex.: um `tenant_id` forjado) são simplesmente ignorados por não estarem no schema.
 */
export const requestSchema = z.discriminatedUnion("action", [
  pairInputSchema,
  sendInputSchema,
]);
export type RequestBody = z.infer<typeof requestSchema>;
export type PairInput = z.infer<typeof pairInputSchema>;
export type SendInput = z.infer<typeof sendInputSchema>;

/** Estados observáveis da conexão — espelha `whatsapp_instances.connection_status`. */
export const connectionStatusSchema = z.enum([
  "desconectado",
  "aguardando_qr",
  "conectado",
]);
export type ConnectionStatus = z.infer<typeof connectionStatusSchema>;

/** Resposta de `parear`. QR não é persistido; vem só nesta resposta. */
export const pairResponseSchema = z.object({
  connection_status: connectionStatusSchema,
  qr_code_base64: z.string().optional(),
  last_connected_at: z.string().nullable().optional(),
});
export type PairResponse = z.infer<typeof pairResponseSchema>;

/** Resultado do envio: enviado, deduplicado, bloqueado por opt-in, ou instância não conectada. */
export const sendOutcomeSchema = z.enum([
  "sent",
  "duplicate",
  "opt_out",
  "not_connected",
]);
export type SendOutcome = z.infer<typeof sendOutcomeSchema>;

export const messageStatusSchema = z.enum([
  "fila",
  "enviado",
  "entregue",
  "falha",
]);
export type MessageStatus = z.infer<typeof messageStatusSchema>;

/** Resposta de `enviar` — contrato validado pela UI (ADR-06). */
export const sendResponseSchema = z.object({
  outcome: sendOutcomeSchema,
  message_id: z.string().uuid().nullable(),
  status: messageStatusSchema,
  provider_message_id: z.string().nullable().optional(),
});
export type SendResponse = z.infer<typeof sendResponseSchema>;
