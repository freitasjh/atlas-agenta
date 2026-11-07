import { z } from "npm:zod@3.23.8";

export const MAX_APPOINTMENT_IDS = 200;

/** Corpo estrito: `tenant_id`/`role` (ou qualquer campo extra) derrubam a chamada. */
export const requestSchema = z
  .object({
    appointment_ids: z.array(z.string().uuid()).min(1).max(MAX_APPOINTMENT_IDS),
  })
  .strict();

export type RequestInput = z.infer<typeof requestSchema>;
