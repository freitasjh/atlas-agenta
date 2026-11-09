// Schemas zod da Edge Function `admin-plan` — troca de plano auditada.
// Payload é DADO NÃO CONFIÁVEL: validar com zod. tenantId é o ALVO (super_admin
// opera cross-tenant por design); ator/papel vêm do JWT/profiles no servidor.
// Contrato de fio alinhado ao frontend (src/lib/validations/admin-plan.ts).
import { z } from "npm:zod@3.23.8";

export const planSchema = z.enum(["individual", "clinica", "pro"]);
export type Plan = z.infer<typeof planSchema>;

export const setPlanInputSchema = z.object({
  action: z.literal("set_plan"),
  tenantId: z.string().uuid({ message: "tenantId deve ser um UUID válido." }),
  plan: planSchema,
  reason: z
    .string()
    .trim()
    .min(10, { message: "O motivo deve ter pelo menos 10 caracteres." })
    .max(280, { message: "O motivo deve ter no máximo 280 caracteres." }),
  override: z.boolean().optional().default(false),
});
export type SetPlanInput = z.infer<typeof setPlanInputSchema>;

export const requestSchema = z.discriminatedUnion("action", [setPlanInputSchema]);
export type RequestBody = z.infer<typeof requestSchema>;

export const setPlanResponseSchema = z.object({
  ok: z.literal(true),
  tenant_id: z.string().uuid(),
  old_plan: planSchema,
  new_plan: planSchema,
});
export type SetPlanResponse = z.infer<typeof setPlanResponseSchema>;
