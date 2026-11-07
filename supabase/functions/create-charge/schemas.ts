import { z } from "npm:zod@3.23.8";

export const requestSchema = z
  .object({
    appointment_id: z.string().uuid(),
    amount_cents: z.number().int().positive().optional(),
    idempotency_key: z.string().uuid().optional(),
  })
  .strict();

export type RequestInput = z.infer<typeof requestSchema>;
