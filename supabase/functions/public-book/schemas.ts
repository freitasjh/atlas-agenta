import { z } from "npm:zod@3.23.8";

export const publicBookBodySchema = z
  .object({
    token: z.string().uuid(),
    service_id: z.string().uuid(),
    professional_id: z.string().uuid(),
    starts_at: z.string().datetime({ offset: true }),
    customer_name: z.string().trim().min(1).max(200),
    customer_phone: z.string().trim().min(8).max(40),
  })
  .strict();

export type PublicBookBody = z.infer<typeof publicBookBodySchema>;

export type PublicBookBodyErrorCode = "invalid_body";

export function parsePublicBookBody(
  raw: unknown,
): { ok: true; body: PublicBookBody } | { ok: false; code: PublicBookBodyErrorCode } {
  const result = publicBookBodySchema.safeParse(raw);
  if (!result.success) return { ok: false, code: "invalid_body" };
  return { ok: true, body: result.data };
}