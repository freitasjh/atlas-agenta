import { z } from "npm:zod@3.23.8";

export const unlinkProfessionalProfileSchema = z
  .object({
    professional_id: z.string().uuid(),
  })
  .strict();

export type UnlinkProfessionalProfileBody = z.infer<typeof unlinkProfessionalProfileSchema>;

export type UnlinkProfessionalProfileBodyErrorCode = "invalid_body";

export function parseUnlinkProfessionalProfileBody(
  raw: unknown,
): { ok: true; body: UnlinkProfessionalProfileBody } | { ok: false; code: UnlinkProfessionalProfileBodyErrorCode } {
  const result = unlinkProfessionalProfileSchema.safeParse(raw);
  if (!result.success) return { ok: false, code: "invalid_body" };
  return { ok: true, body: result.data };
}