import { z } from "npm:zod@3.23.8";

export const acceptSchema = z
  .object({
    token: z.string().min(16),
    password: z.string().min(8).max(72).optional(),
  })
  .strict();

export type AcceptBody = z.infer<typeof acceptSchema>;

export type AcceptBodyErrorCode = "invalid_body";

export function parseAcceptBody(
  raw: unknown,
): { ok: true; body: AcceptBody } | { ok: false; code: AcceptBodyErrorCode } {
  const result = acceptSchema.safeParse(raw);
  if (!result.success) return { ok: false, code: "invalid_body" };
  return { ok: true, body: result.data };
}
