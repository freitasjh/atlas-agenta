import { useQuery } from "@tanstack/react-query";
import { z } from "zod";

import { supabase } from "@/lib/supabase";
import { SUBSCRIPTION_STATUSES } from "@/types/domain";

/**
 * Hooks de dados do back-office T1.4/T1.5 (ADR-11) — **somente leitura**.
 *
 * Todo acesso passa por RPC `SECURITY DEFINER` com guard `super_admin` (as
 * RPCs respondem `PT403` para os demais papéis); o cliente nunca lê
 * `membership_*`/`fiscal_documents` cross-tenant direto (RLS é do tenant).
 * Respostas são dado não confiável: validadas por zod antes do uso.
 *
 * Cada hook recebe `enabled` — o gating (`useBackofficeEntitlements`) desliga
 * a query e garante **zero request** quando a capacidade não está liberada.
 */

const ISO_DATE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;

export function isIsoDate(value: string): boolean {
  return ISO_DATE.test(value);
}

export function isValidPeriod(from: string, to: string): boolean {
  return isIsoDate(from) && isIsoDate(to) && from <= to;
}

// --- Assinaturas cross-tenant (aba Operação) --------------------------------

export const BACKOFFICE_SUBSCRIPTIONS_KEY = [
  "admin",
  "backoffice",
  "subscriptions",
] as const;

const backofficeSubscriptionSchema = z.object({
  tenant_id: z.string().uuid(),
  tenant_name: z.string(),
  subscription_id: z.string().uuid(),
  customer_name: z.string(),
  plan_name: z.string(),
  billing_period: z.enum(["mensal", "trimestral", "anual"]),
  amount_cents: z.number().int(),
  status: z.enum(["ativa", "inadimplente", "pausada", "cancelada"]),
  next_charge_at: z.string().nullable(),
  overdue_charges: z.number().int(),
  overdue_amount_cents: z.number().int(),
});

const backofficeSubscriptionsSchema = z.array(backofficeSubscriptionSchema);

export type BackofficeSubscription = z.infer<
  typeof backofficeSubscriptionSchema
>;

export function useBackofficeSubscriptions(enabled: boolean) {
  return useQuery<BackofficeSubscription[]>({
    queryKey: BACKOFFICE_SUBSCRIPTIONS_KEY,
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("backoffice_subscriptions");
      if (error) throw error;
      return backofficeSubscriptionsSchema.parse(data ?? []);
    },
  });
}

// --- MRR SaaS (kind=saas) ---------------------------------------------------

const planMrrEntrySchema = z.object({
  base: z.number().int(),
  mrr_cents: z.number().int(),
});

const saasMrrSchema = z.object({
  kind: z.literal("saas"),
  as_of: z.string(),
  mrr_cents: z.number().int(),
  base_ativa: z.number().int(),
  by_plan: z.record(z.string(), planMrrEntrySchema).default({}),
});

export type SaasMrr = z.infer<typeof saasMrrSchema>;

/**
 * MRR SaaS **atual** (`mrr_report()`): snapshot do instante, sem parâmetro de
 * mês. A UI rotula "atual" e não oferece seleção de mês para esta métrica.
 */
export function useBackofficeSaasMrr(enabled: boolean) {
  return useQuery<SaasMrr>({
    queryKey: ["admin", "backoffice", "mrr-saas"],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("mrr_report");
      if (error) throw error;
      return saasMrrSchema.parse(data);
    },
  });
}

// --- MRR/churn membership (kind=membership) ---------------------------------

const membershipMrrChurnSchema = z.object({
  kind: z.literal("membership"),
  from: z.string(),
  to: z.string(),
  mrr_cents: z.number().int(),
  mrr_em_risco_cents: z.number().int(),
  ativas: z.number().int(),
  inadimplentes: z.number().int(),
  pausadas: z.number().int(),
  canceladas_periodo: z.number().int(),
  base_inicio: z.number().int(),
  churn_pct: z.number().nullable(),
});

export type MembershipMrrChurn = z.infer<typeof membershipMrrChurnSchema>;

export function useBackofficeMembershipMrrChurn(
  enabled: boolean,
  from: string,
  to: string,
) {
  return useQuery<MembershipMrrChurn>({
    queryKey: ["admin", "backoffice", "membership-mrr-churn", from, to],
    enabled: enabled && isValidPeriod(from, to),
    queryFn: async () => {
      const { data, error } = await supabase.rpc("membership_mrr_churn", {
        p_from: from,
        p_to: to,
      });
      if (error) throw error;
      return membershipMrrChurnSchema.parse(data);
    },
  });
}

// --- Volume NFCe (kind=nfce) ------------------------------------------------

const nfceVolumeSchema = z.object({
  kind: z.literal("nfce"),
  from: z.string(),
  to: z.string(),
  autorizadas: z.number().int(),
  contingencia: z.number().int(),
  rejeitadas: z.number().int(),
  canceladas: z.number().int(),
  pendentes: z.number().int(),
  valor_autorizado_cents: z.number().int(),
});

export type NfceVolume = z.infer<typeof nfceVolumeSchema>;

export function useBackofficeNfceVolume(
  enabled: boolean,
  from: string,
  to: string,
) {
  return useQuery<NfceVolume>({
    queryKey: ["admin", "backoffice", "nfce-volume", from, to],
    enabled: enabled && isValidPeriod(from, to),
    queryFn: async () => {
      const { data, error } = await supabase.rpc("nfce_volume", {
        p_from: from,
        p_to: to,
      });
      if (error) throw error;
      return nfceVolumeSchema.parse(data);
    },
  });
}

// --- Trilha de auditoria da assinatura --------------------------------------

export const BACKOFFICE_STATUS_AUDIT_KEY = [
  "admin",
  "backoffice",
  "status-audit",
] as const;

const statusAuditRowSchema = z.object({
  id: z.string().uuid(),
  tenant_id: z.string().uuid(),
  changed_by: z.string().uuid().nullable(),
  old_status: z.enum(SUBSCRIPTION_STATUSES),
  new_status: z.enum(SUBSCRIPTION_STATUSES),
  reason: z.string().nullable(),
  created_at: z.string(),
});

export type StatusAuditEntry = z.infer<typeof statusAuditRowSchema>;

/**
 * Trilha de suspensão/retomada. A tabela `subscription_status_changes` tem RLS
 * `super_admin` — a leitura não filtra por tenant (é cross-tenant por desenho).
 */
export function useBackofficeStatusAudit(enabled: boolean, limit = 25) {
  return useQuery<StatusAuditEntry[]>({
    queryKey: [...BACKOFFICE_STATUS_AUDIT_KEY, limit],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("subscription_status_changes")
        .select("id, tenant_id, changed_by, old_status, new_status, reason, created_at")
        .order("created_at", { ascending: false })
        .limit(limit);
      if (error) throw error;
      return z.array(statusAuditRowSchema).parse(data ?? []);
    },
  });
}
