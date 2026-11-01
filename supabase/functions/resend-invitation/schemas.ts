import { z } from "npm:zod@3.23.8";

export const resendSchema = z
  .object({
    invitation_id: z.string().uuid(),
  })
  .strict();

export type ResendBody = z.infer<typeof resendSchema>;

export type ResendBodyErrorCode = "invalid_body";

export function parseResendBody(
  raw: unknown,
): { ok: true; body: ResendBody } | { ok: false; code: ResendBodyErrorCode } {
  const result = resendSchema.safeParse(raw);
  if (!result.success) return { ok: false, code: "invalid_body" };
  return { ok: true, body: result.data };
}
