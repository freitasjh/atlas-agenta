import { z } from "npm:zod@3.23.8";

export const requestSchema = z
  .object({
    payment_id: z.string().uuid(),
    reason: z
      .string()
      .max(500)
      .refine((value) => value.trim().length > 0, { message: "reason_empty" }),
  })
  .strict();

export type RequestInput = z.infer<typeof requestSchema>;
