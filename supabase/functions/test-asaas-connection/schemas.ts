import { z } from "npm:zod@3.23.8";

export const requestSchema = z.object({
  apiKey: z.string().min(1),
  environment: z.enum(["sandbox", "production"]).default("sandbox"),
});
export type RequestInput = z.infer<typeof requestSchema>;

export const responseSchema = z.object({
  ok: z.boolean(),
  account_id: z.string().optional(),
  name: z.string().optional(),
});
