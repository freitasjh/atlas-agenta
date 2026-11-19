import { z } from "npm:zod@3.23.8";

export const requestSchema = z
  .object({
    professional_id: z.string().uuid(),
    service_id: z.string().uuid().optional(),
    combo_id: z.string().uuid().optional(),
    product_id: z.string().uuid().optional(),
    product_qty: z.number().int().min(1).optional(),
    customer_id: z.string().uuid().nullable().optional(),
    creation_idempotency_key: z.string().uuid(),
  })
  .strict()
  .refine(
    (body) => {
      const count = [body.service_id, body.combo_id, body.product_id].filter((v) => v != null).length;
      return count === 1;
    },
    { message: "XOR_ITEM_REQUIRED" },
  )
  .refine(
    (body) => {
      if (body.product_id != null) {
        return (body.product_qty ?? 1) >= 1;
      }
      return true;
    },
    { message: "PRODUCT_QTY_REQUIRED" },
  )
  .transform((body) => ({
    ...body,
    product_qty: body.product_id != null ? (body.product_qty ?? 1) : 0,
  }));

export type RequestInput = z.infer<typeof requestSchema>;