import { z } from "npm:zod@3.23.8";

export const requestSchema = z
  .object({
    charge_id: z.string().uuid(),
    paid_at: z.string().datetime({ offset: true }).optional(),
  })
  .strict();

export type RequestInput = z.infer<typeof requestSchema>;
