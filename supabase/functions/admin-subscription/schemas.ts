// Schemas zod da Edge Function `admin-subscription` — ADR-03 (Fatia 1 do Painel do Super Admin).
//
// O payload de invocação é DADO NÃO CONFIÁVEL: validar com zod antes de usar. Qualquer
// `tenant_id`/`role`/`changed_by` enviado no corpo é IGNORADO — o ator e o papel vêm sempre do
// JWT/profiles resolvidos NO SERVIDOR (RNF03, inegociável). O `tenantId` do corpo é o ALVO da
// operação (o super_admin opera sobre outro tenant por design), nunca a credencial.
//
// Esta ADR é a DONA do contrato de fio: qualquer mudança aqui obriga atualizar os zod schemas do
// frontend (ADR-04). Status HTTP das condições: 200/400/401/403/404/409/500.

import { z } from "npm:zod@3.23.8";

/** Status de assinatura — espelha SUBSCRIPTION_STATUSES (src/types/domain.ts) e o CHECK de tenants. */
export const subscriptionStatusSchema = z.enum([
  "trial",
  "ativo",
  "pendente",
  "bloqueado",
  "cancelado",
]);
export type SubscriptionStatus = z.infer<typeof subscriptionStatusSchema>;

/**
 * `{ action: 'set_status', tenantId, status, reason? }`. O contrato usa camelCase, alinhado ao
 * consumidor (ADR-04/05). `reason` é motivo curto não-PII (≤280). `tenantId` é o ALVO; o ator vem
 * do JWT no servidor.
 */
export const setStatusInputSchema = z.object({
  action: z.literal("set_status"),
  tenantId: z.string().uuid({ message: "tenantId deve ser um UUID válido." }),
  status: subscriptionStatusSchema,
  reason: z.string().trim().max(280, { message: "O motivo deve ter no máximo 280 caracteres." }).optional(),
});
export type SetStatusInput = z.infer<typeof setStatusInputSchema>;

/**
 * Discriminated union por `action` (extensível a novas ações do admin). Campos extras (ex.: um
 * `changed_by`/`role` forjado) são simplesmente IGNORADOS por não estarem no schema.
 */
export const requestSchema = z.discriminatedUnion("action", [setStatusInputSchema]);
export type RequestBody = z.infer<typeof requestSchema>;

/** DTO de sucesso de `set_status` — contrato validado pela UI (ADR-04/05). */
export const setStatusResponseSchema = z.object({
  ok: z.literal(true),
  tenant_id: z.string().uuid(),
  old_status: subscriptionStatusSchema,
  new_status: subscriptionStatusSchema,
});
export type SetStatusResponse = z.infer<typeof setStatusResponseSchema>;
