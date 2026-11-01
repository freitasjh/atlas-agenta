import { z } from "npm:zod@3.23.8";

export const revokeSchema = z
  .object({
    invitation_id: z.string().uuid().optional(),
    token: z.string().min(16).optional(),
  })
  .strict()
  .refine((v) => Boolean(v.invitation_id || v.token), { message: "invalid_body" });

export type RevokeBody = z.infer<typeof revokeSchema>;

export type RevokeBodyErrorCode = "invalid_body";

export function parseRevokeBody(
  raw: unknown,
): { ok: true; body: RevokeBody } | { ok: false; code: RevokeBodyErrorCode } {
  const result = revokeSchema.safeParse(raw);
  if (!result.success) return { ok: false, code: "invalid_body" };
  return { ok: true, body: result.data };
}
