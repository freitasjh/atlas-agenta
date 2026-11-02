import { z } from "npm:zod@3.23.8";
export const requestSchema = z.object({
  tenant_id: z.string().uuid(),
  plan: z.string(),
  billing_period: z.enum(["monthly", "annual"]).default("monthly"),
});
export type RequestInput = z.infer<typeof requestSchema>;
