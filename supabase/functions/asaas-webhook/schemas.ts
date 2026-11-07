import { z } from "npm:zod@3.23.8";

// Payload do Asaas: exige apenas o necessário e nunca rejeita campo extra.
// `payment.*` financeiro fica tolerante (`unknown`) — helpers convertem sem derrubar o evento.
export const paymentSchema = z
  .object({
    id: z.string().min(1),
    value: z.unknown().optional(),
    paymentDate: z.unknown().optional(),
    confirmedDate: z.unknown().optional(),
    externalReference: z.unknown().optional(),
    status: z.unknown().optional(),
  })
  .passthrough();

export const payloadSchema = z
  .object({
    id: z.string().min(1),
    event: z.string().min(1),
    payment: paymentSchema.optional(),
  })
  .passthrough();

export type Payload = z.infer<typeof payloadSchema>;
export type PaymentPayload = z.infer<typeof paymentSchema>;
