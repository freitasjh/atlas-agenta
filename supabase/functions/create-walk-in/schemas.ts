import { z } from "npm:zod@3.23.8";

// PDV balcão (ADR-22): entrada da venda walk-in. `tenant_id`, preço e origem
// NUNCA vêm do corpo — identidade do JWT + snapshot do servidor.
// `creation_idempotency_key` obrigatória por clique (frontend gera
// `crypto.randomUUID()` e reusa em retry); mesma chave devolve o existente.
export const requestSchema = z
  .object({
    professional_id: z.string().uuid(),
    service_id: z.string().uuid().optional(),
    combo_id: z.string().uuid().optional(),
    customer_id: z.string().uuid().nullable().optional(),
    creation_idempotency_key: z.string().uuid(),
  })
  .strict()
  .refine((body) => (body.service_id == null) !== (body.combo_id == null), {
    message: "XOR_SERVICE_COMBO_REQUIRED",
  });

export type RequestInput = z.infer<typeof requestSchema>;
