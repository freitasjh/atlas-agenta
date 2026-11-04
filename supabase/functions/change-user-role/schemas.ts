import { z } from "npm:zod@3.23.8";

export const CHANGE_USER_ROLES = ["admin", "professional", "receptionist"] as const;

export const changeUserRoleSchema = z
  .object({
    user_id: z.string().uuid(),
    new_role: z.enum(CHANGE_USER_ROLES),
  })
  .strict();

export type ChangeUserRoleBody = z.infer<typeof changeUserRoleSchema>;

export type ChangeUserRoleBodyErrorCode = "invalid_body";

export function parseChangeUserRoleBody(
  raw: unknown,
): { ok: true; body: ChangeUserRoleBody } | { ok: false; code: ChangeUserRoleBodyErrorCode } {
  const result = changeUserRoleSchema.safeParse(raw);
  if (!result.success) return { ok: false, code: "invalid_body" };
  return { ok: true, body: result.data };
}