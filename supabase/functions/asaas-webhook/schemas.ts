import { z } from "npm:zod@3.23.8";
export const payloadSchema = z.object({
  event: z.string(),
  payment: z.object({
    id: z.string(),
    status: z.string().optional(),
  }).passthrough().optional(),
}).passthrough();
export type Payload = z.infer<typeof payloadSchema>;
