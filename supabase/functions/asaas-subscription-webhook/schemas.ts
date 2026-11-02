import { z } from "npm:zod@3.23.8";
export const payloadSchema = z.object({
  event: z.string(),
  payment: z.object({ id: z.string() }).passthrough().optional(),
}).passthrough();
