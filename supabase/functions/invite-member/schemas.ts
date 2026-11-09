import { z } from "npm:zod@3.23.8";

export const INVITE_ROLES = [
  "super_admin",
  "admin",
  "professional",
  "receptionist",
] as const;

export const inviteSchema = z
  .object({
    email: z.string().email(),
    role: z.enum(INVITE_ROLES),
    professional_id: z.string().uuid().optional(),
    // MIG-BE-02: alvo obrigatório no caminho do operador interno (TenantPlano/
    // Convites sob `/internal-admin`). Opcional p/ compat: o legado deriva o
    // tenant do perfil; o operador informa o alvo no corpo.
    tenant_id: z.string().uuid().optional(),
  })
  .strict();

export type InviteBody = z.infer<typeof inviteSchema>;

export type InviteBodyErrorCode = "invalid_body";

export function parseInviteBody(
  raw: unknown,
): { ok: true; body: InviteBody } | { ok: false; code: InviteBodyErrorCode } {
  const result = inviteSchema.safeParse(raw);
  if (!result.success) return { ok: false, code: "invalid_body" };
  return { ok: true, body: result.data };
}
