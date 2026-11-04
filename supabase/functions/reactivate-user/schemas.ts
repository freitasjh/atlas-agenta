import { z } from "npm:zod@3.23.8";

export const reactivateSchema = z
  .object({
    user_id: z.string().uuid(),
  })
  .strict();

export type ReactivateBody = z.infer<typeof reactivateSchema>;

export type ReactivateBodyErrorCode = "invalid_body";

export function parseReactivateBody(
  raw: unknown,
): { ok: true; body: ReactivateBody } | { ok: false; code: ReactivateBodyErrorCode } {
  const result = reactivateSchema.safeParse(raw);
  if (!result.success) return { ok: false, code: "invalid_body" };
  return { ok: true, body: result.data };
}