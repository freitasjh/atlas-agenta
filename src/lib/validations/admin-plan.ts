import { z } from "zod";

import { PLAN_SLUGS } from "@/lib/plans";

/**
 * Schemas zod da fatia "backoffice-plan-control" (troca de plano auditada).
 * Espelham o contrato da Edge Function `admin-plan` (reason 10..280, override).
 * Mensagens de usuário em pt-BR. Dado não confiável: validar na borda.
 */

/** Limites do motivo (espelham o CHECK do banco + zod da Edge). */
export const PLAN_REASON_MIN_LENGTH = 10;
export const PLAN_REASON_MAX_LENGTH = 280;

/**
 * Form do wizard "Trocar plano": destino + motivo obrigatório (10..280, trim)
 * + override (double-confirm quando uso acima do limite).
 */
export const changePlanFormSchema = z.object({
  plan: z.enum(PLAN_SLUGS, {
    required_error: "Selecione o plano destino.",
    invalid_type_error: "Selecione o plano destino.",
    message: "Selecione o plano destino.",
  }),
  reason: z
    .string()
    .trim()
    .min(PLAN_REASON_MIN_LENGTH, "O motivo deve ter pelo menos 10 caracteres.")
    .max(PLAN_REASON_MAX_LENGTH, "O motivo deve ter no máximo 280 caracteres."),
  override: z.boolean().default(false),
});

export type ChangePlanFormValues = z.infer<typeof changePlanFormSchema>;

/** DTO de sucesso da Edge Function `admin-plan`. */
export const changePlanResponseSchema = z.object({
  ok: z.literal(true),
  tenant_id: z.string().uuid(),
  old_plan: z.enum(PLAN_SLUGS),
  new_plan: z.enum(PLAN_SLUGS),
});

export type ChangePlanResponse = z.infer<typeof changePlanResponseSchema>;

/** Uso atual do tenant (lido via RPC `admin_get_tenant_plan`, dado não confiável). */
export const tenantPlanUsageSchema = z.object({
  plan: z.enum(PLAN_SLUGS),
  active_professionals: z.number().int().min(0),
  month_appointments: z.number().int().min(0),
  month_key: z.string().min(1),
});

export type TenantPlanUsage = z.infer<typeof tenantPlanUsageSchema>;
