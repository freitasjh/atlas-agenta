import { z } from "npm:zod@3.23.8";

export const deactivateSchema = z
  .object({
    user_id: z.string().uuid(),
  })
  .strict();

export type DeactivateBody = z.infer<typeof deactivateSchema>;

export type DeactivateBodyErrorCode = "invalid_body";

export function parseDeactivateBody(
  raw: unknown,
): { ok: true; body: DeactivateBody } | { ok: false; code: DeactivateBodyErrorCode } {
  const result = deactivateSchema.safeParse(raw);
  if (!result.success) return { ok: false, code: "invalid_body" };
  return { ok: true, body: result.data };
}