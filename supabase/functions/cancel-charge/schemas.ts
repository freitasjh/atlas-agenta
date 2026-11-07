import { z } from "npm:zod@3.23.8";

export const requestSchema = z
  .object({
    charge_id: z.string().uuid(),
    force: z.boolean().optional().default(false),
  })
  .strict();

export type RequestInput = z.infer<typeof requestSchema>;
