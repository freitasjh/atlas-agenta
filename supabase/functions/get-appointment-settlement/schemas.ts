import { z } from "npm:zod@3.23.8";

export const requestSchema = z
  .object({
    appointment_id: z.string().uuid(),
  })
  .strict();

export type RequestInput = z.infer<typeof requestSchema>;
