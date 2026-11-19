import { z } from "npm:zod@3.23.8";

/**
 * Checkout self-service (ADR-10): o admin do tenant troca de plano sozinho.
 * `plan` é validado contra o catálogo SSoT `public.plans` no handler —
 * slug inexistente/inativo é 400, nunca um preço default silencioso.
 * `idempotency_key` (uuid do cliente) torna o retry seguro: mesma chave
 * devolve a cobrança existente (`replayed: true`) em vez de duplicar.
 */
export const requestSchema = z.object({
  plan: z.string().trim().min(1).max(64),
  idempotency_key: z.string().uuid().optional(),
});
export type RequestInput = z.infer<typeof requestSchema>;
