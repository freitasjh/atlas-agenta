import { z } from "npm:zod@3.23.8";
import { PAYMENT_METHODS } from "../_shared/payments.ts";

export const paymentItemSchema = z
  .object({
    method: z.enum(PAYMENT_METHODS),
    amount_cents: z.number().int().positive(),
    tip_cents: z.number().int().nonnegative().optional(),
  })
  .strict();

export const requestSchema = z
  .object({
    appointment_id: z.string().uuid(),
    idempotency_key: z.string().uuid(),
    close_appointment: z.boolean().optional().default(true),
    payments: z.array(paymentItemSchema).max(10),
  })
  .strict();

export type RequestInput = z.infer<typeof requestSchema>;

/** Código estável para um erro de schema (distingue método/valor). */
export function schemaErrorCode(error: z.ZodError): string {
  for (const issue of error.issues) {
    const path = issue.path.map((part) => String(part));
    if (path.includes("method")) return "INVALID_METHOD";
    if (path.includes("amount_cents") || path.includes("tip_cents")) return "INVALID_AMOUNT";
    if (issue.code === "too_big" && path[0] === "payments") return "INVALID_AMOUNT";
  }
  return "INVALID_BODY";
}
