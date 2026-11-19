import { z } from "npm:zod@3.23.8";

export const requestSchema = z
  .object({
    campaign_id: z.string().uuid(),
    limit: z.number().int().min(1).max(200).optional().default(50),
  })
  .strict();

export type RequestInput = z.infer<typeof requestSchema>;
