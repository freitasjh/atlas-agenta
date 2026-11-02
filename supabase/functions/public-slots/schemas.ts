import { z } from "npm:zod@3.23.8";

export const publicSlotsQuerySchema = z.object({
  token: z.string().uuid(),
  service_id: z.string().uuid(),
  professional_id: z.string().uuid().optional().nullable(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export type PublicSlotsQuery = z.infer<typeof publicSlotsQuerySchema>;

export type PublicSlotsQueryErrorCode = "invalid_body";

export function parsePublicSlotsQuery(
  raw: unknown,
): { ok: true; query: PublicSlotsQuery } | { ok: false; code: PublicSlotsQueryErrorCode } {
  const result = publicSlotsQuerySchema.safeParse(raw);
  if (!result.success) return { ok: false, code: "invalid_body" };
  return { ok: true, query: result.data };
}