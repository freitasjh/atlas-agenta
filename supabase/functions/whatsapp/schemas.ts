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

/** `{ action: 'pair' }` — sem outros campos; tenant_id derivado do JWT. */
export const pairInputSchema = z.object({
  action: z.literal("pair"),
});

/**
 * `{ action: 'send', template, customerId, appointmentId? }`. O contrato de fio usa camelCase
 * (`customerId`/`appointmentId`), alinhado ao consumidor (ADR-06) e à análise de frontend. Esta
 * ADR é a DONA do contrato: qualquer mudança aqui obriga atualizar os zod schemas do frontend.
 */
export const sendInputSchema = z.object({
  action: z.literal("send"),
  template: templateSchema,
  customerId: z.string().uuid({ message: "customerId deve ser um UUID válido." }),
  appointmentId: z
    .string()
    .uuid({ message: "appointmentId deve ser um UUID válido." })
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

/** Resposta de `pair`. QR não é persistido; vem só nesta resposta. */
export const pairResponseSchema = z.object({
  connection_status: connectionStatusSchema,
  qr_code_base64: z.string().optional(),
  last_connected_at: z.string().nullable().optional(),
});
export type PairResponse = z.infer<typeof pairResponseSchema>;

/**
 * Resultado do envio. Cada valor é um estado de negócio distinto que a UI (ADR-06) traduz para
 * uma mensagem própria — por isso `send_failed` (falha do provedor) é separado de `not_connected`
 * (instância desconectada): conflacioná-los faria o 502 ser lido como "conecte o WhatsApp".
 *  - `sent`          → mensagem aceita pelo provedor.
 *  - `duplicate`     → já havia um disparo vivo com a mesma chave (idempotência).
 *  - `opt_out`       → cliente sem consentimento LGPD; nada enviado.
 *  - `not_connected` → instância do tenant não está conectada.
 *  - `send_failed`   → provedor recusou/falhou o envio.
 */
export const sendOutcomeSchema = z.enum([
  "sent",
  "duplicate",
  "opt_out",
  "not_connected",
  "send_failed",
]);
export type SendOutcome = z.infer<typeof sendOutcomeSchema>;

export const messageStatusSchema = z.enum([
  "fila",
  "enviado",
  "entregue",
  "falha",
]);
export type MessageStatus = z.infer<typeof messageStatusSchema>;

/**
 * Resposta de `send` — contrato validado pela UI (ADR-06). TODAS as condições de negócio do
 * `send` (sucesso, duplicado, opt-out, não-conectado, falha de provedor) retornam ESTE shape no
 * corpo, mesmo quando o status HTTP não é 200. Assim a UI sempre valida com zod e lê o `outcome`
 * para decidir a mensagem, sem depender do canal de erro do `functions.invoke`. Os erros
 * puramente infra/auth (400/401/403/404/500) usam o shape `{ error, issues? }` e caem no canal
 * de erro do invoke.
 */
export const sendResponseSchema = z.object({
  outcome: sendOutcomeSchema,
  message_id: z.string().uuid().nullable(),
  status: messageStatusSchema,
  provider_message_id: z.string().nullable().optional(),
});
export type SendResponse = z.infer<typeof sendResponseSchema>;
