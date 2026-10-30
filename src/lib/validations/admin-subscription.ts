import { z } from "zod";

import { PLAN_SLUGS } from "@/lib/plans";
import { SUBSCRIPTION_STATUSES } from "@/types/domain";

/**
 * Schemas zod da fatia "Painel do Super Admin — Empresas" (ADR-04). Materializam
 * o contrato da Edge Function `admin-subscription` (ADR-03) e validam as
 * respostas do PostgREST — **dado não confiável** — na borda dos hooks (ADR-05)
 * e do form do dialog (ADR-07). Enums reusam a fonte única de domínio
 * (`SUBSCRIPTION_STATUSES`) e de plano (`PLAN_SLUGS`), sem strings mágicas.
 */

/**
 * Form do dialog "Mudar status" (ADR-07): destino + motivo opcional (≤280,
 * trim). O destino é validado como enum de domínio; a trava de *transição*
 * válida é do servidor (a UI só esconde destinos inválidos — ver
 * `subscription-status.ts`). Mensagens de usuário em pt-BR.
 */
export const changeStatusFormSchema = z.object({
  status: z.enum(SUBSCRIPTION_STATUSES),
  reason: z
    .string()
    .trim()
    .max(280, "O motivo deve ter no máximo 280 caracteres.")
    .optional(),
});

export type ChangeStatusFormValues = z.infer<typeof changeStatusFormSchema>;

/**
 * Shape de uma linha de `tenants` lida cross-tenant pelo super_admin — espelha
 * `TenantListItem` (`src/types/domain.ts`). Valida a resposta do PostgREST antes
 * do uso; `plan`/`subscription_status` como enums de domínio.
 */
export const adminTenantRowSchema = z.object({
  id: z.string().uuid(),
  trade_name: z.string().nullable(),
  legal_name: z.string(),
  document: z.string().nullable(),
  owner_email: z.string(),
  plan: z.enum(PLAN_SLUGS),
  subscription_status: z.enum(SUBSCRIPTION_STATUSES),
  trial_ends_at: z.string().nullable(),
  timezone: z.string(),
  created_at: z.string(),
});

/** Resposta da leitura cross-tenant (array de linhas de tenant). */
export const adminTenantsResponseSchema = z.array(adminTenantRowSchema);

/**
 * DTO de sucesso da Edge Function `admin-subscription` (ADR-03): confirma a
 * mudança com o par de→para. Validado antes de ler `ok`/status (dado não
 * confiável); shape inesperado cai no ramo de erro genérico do hook.
 */
export const changeStatusResponseSchema = z.object({
  ok: z.literal(true),
  tenant_id: z.string().uuid(),
  old_status: z.enum(SUBSCRIPTION_STATUSES),
  new_status: z.enum(SUBSCRIPTION_STATUSES),
});

export type ChangeStatusResponse = z.infer<typeof changeStatusResponseSchema>;
