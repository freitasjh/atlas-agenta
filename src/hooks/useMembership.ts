import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";

import { supabase } from "@/lib/supabase";
import { mapWhatsAppError } from "@/lib/whatsapp-errors";
import {
  MEMBERSHIP_BILLING_PERIODS,
  MEMBERSHIP_CHARGE_STATUSES,
  MEMBERSHIP_SUBSCRIPTION_STATUSES,
  type MembershipBillingPeriod,
  type MembershipCharge,
  type MembershipChargeStatus,
  type MembershipPlan,
  type MembershipSubscription,
  type MembershipSubscriptionStatus,
} from "@/lib/membership";

/**
 * Hooks de dados de membership (Fase 5 ADR-05, UI).
 *
 * Leitura via RLS (admin-only; recepção/profissional sem SELECT; a trava real
 * é a política, nunca filtro de `tenant_id` no cliente). `enabled` vem do
 * gating `recorrencia` da página: `false`/`null` → queries desabilitadas,
 * zero request a `membership_*` (critério ADR-05 §4).
 *
 * Escrita só via RPCs (`membership_update_status` pausar/retomar/cancelar com
 * motivo auditado; `membership_charge_cycle` regularizar idempotente por
 * ciclo — nunca duplica pendente) e Edge `whatsapp` (reenvio `cobranca`,
 * só com opt-in). Toda resposta é dado não confiável: validada por zod.
 */

const planRowSchema = z.object({
  id: z.string(),
  tenant_id: z.string(),
  name: z.string(),
  amount_cents: z.number(),
  billing_period: z.enum(MEMBERSHIP_BILLING_PERIODS),
  active: z.boolean(),
  created_at: z.string(),
});

const subscriptionRowSchema = z.object({
  id: z.string(),
  tenant_id: z.string(),
  customer_id: z.string(),
  plan_id: z.string(),
  status: z.enum(MEMBERSHIP_SUBSCRIPTION_STATUSES),
  next_charge_at: z.string().nullable(),
  created_at: z.string(),
});

const chargeRowSchema = z.object({
  id: z.string(),
  tenant_id: z.string(),
  subscription_id: z.string(),
  cycle_ref: z.string(),
  amount_cents: z.number(),
  status: z.enum(MEMBERSHIP_CHARGE_STATUSES),
  asaas_payment_id: z.string().nullable(),
  due_at: z.string(),
  paid_at: z.string().nullable(),
  created_at: z.string(),
});

const customerOptInSchema = z.object({
  id: z.string(),
  name: z.string(),
  whatsapp_opt_in: z.boolean(),
});

export const MEMBERSHIP_PLANS_KEY = ["membership", "plans"] as const;
export const MEMBERSHIP_SUBSCRIPTIONS_KEY = ["membership", "subscriptions"] as const;
export const MEMBERSHIP_CHARGES_KEY = ["membership", "charges"] as const;
export const MEMBERSHIP_CUSTOMERS_KEY = ["membership", "customers"] as const;

const PLANS_SELECT =
  "id, tenant_id, name, amount_cents, billing_period, active, created_at";
const SUBSCRIPTIONS_SELECT =
  "id, tenant_id, customer_id, plan_id, status, next_charge_at, created_at";
const CHARGES_SELECT =
  "id, tenant_id, subscription_id, cycle_ref, amount_cents, status, asaas_payment_id, due_at, paid_at, created_at";

/** Linha enriquecida para a tabela (nomes resolvidos client-side, sem join). */
export interface AssinaturaLinha {
  subscription: MembershipSubscription;
  planName: string;
  planAmountCents: number;
  billingPeriod: MembershipBillingPeriod;
  customerName: string;
  customerOptIn: boolean;
}

function toPlan(raw: unknown): MembershipPlan | null {
  const parsed = planRowSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export function useMembershipPlans(enabled: boolean) {
  return useQuery<MembershipPlan[]>({
    queryKey: MEMBERSHIP_PLANS_KEY,
    enabled,
    staleTime: 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("membership_plans")
        .select(PLANS_SELECT)
        .eq("active", true)
        .order("name", { ascending: true });
      if (error) throw error;
      return ((data ?? []) as unknown[])
        .map(toPlan)
        .filter((p): p is MembershipPlan => p !== null);
    },
  });
}

export function useMembershipSubscriptions(enabled: boolean) {
  return useQuery<MembershipSubscription[]>({
    queryKey: MEMBERSHIP_SUBSCRIPTIONS_KEY,
    enabled,
    staleTime: 30 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("membership_subscriptions")
        .select(SUBSCRIPTIONS_SELECT)
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return ((data ?? []) as unknown[])
        .map((raw) => subscriptionRowSchema.safeParse(raw))
        .filter((r) => r.success)
        .map((r) => (r as { data: MembershipSubscription }).data);
    },
  });
}

export function useMembershipCharges(subscriptionId: string | null, enabled: boolean) {
  return useQuery<MembershipCharge[]>({
    queryKey: [...MEMBERSHIP_CHARGES_KEY, subscriptionId ?? "todas"],
    enabled: enabled && subscriptionId !== null,
    staleTime: 30 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("membership_charges")
        .select(CHARGES_SELECT)
        .eq("subscription_id", subscriptionId as string)
        .order("due_at", { ascending: false })
        .limit(60);
      if (error) throw error;
      return ((data ?? []) as unknown[])
        .map((raw) => chargeRowSchema.safeParse(raw))
        .filter((r) => r.success)
        .map((r) => (r as { data: MembershipCharge }).data);
    },
  });
}

export interface MembershipCustomerOptIn {
  id: string;
  name: string;
  whatsapp_opt_in: boolean;
}

/** Nome + opt-in dos clientes (projeção sem PII: sem telefone/e-mail). */
export function useMembershipCustomers(enabled: boolean) {
  return useQuery<MembershipCustomerOptIn[]>({
    queryKey: MEMBERSHIP_CUSTOMERS_KEY,
    enabled,
    staleTime: 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("customers")
        .select("id, name, whatsapp_opt_in")
        .eq("active", true)
        .order("name", { ascending: true })
        .limit(500);
      if (error) throw error;
      return ((data ?? []) as unknown[])
        .map((raw) => customerOptInSchema.safeParse(raw))
        .filter((r) => r.success)
        .map((r) => (r as { data: MembershipCustomerOptIn }).data);
    },
  });
}

export const updateMembershipStatusInputSchema = z.object({
  subscriptionId: z.string().uuid("Assinatura inválida."),
  acao: z.enum(["pausar", "retomar", "cancelar"], {
    errorMap: () => ({ message: "Ação inválida." }),
  }),
  motivo: z
    .string()
    .trim()
    .min(3, "Informe o motivo do cancelamento.")
    .max(500, "O motivo é muito longo.")
    .optional(),
});

export type UpdateMembershipStatusInput = z.infer<
  typeof updateMembershipStatusInputSchema
>;

/**
 * Pausar/retomar/cancelar via `membership_update_status`. Cancelar exige
 * motivo (validado aqui para feedback imediato; a trava real audita no
 * servidor). Retorna o status resultante para a UI otimista.
 *
 * Contrato RPC (servidor): `p_status` ∈ ativa/pausada/cancelada + `p_reason`.
 * A UI fala em ações (pausar/retomar/cancelar) — o mapeamento vive aqui.
 */
const STATUS_POR_ACAO = {
  pausar: "pausada",
  retomar: "ativa",
  cancelar: "cancelada",
} as const;

export function useUpdateMembershipStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: UpdateMembershipStatusInput) => {
      const parsed = updateMembershipStatusInputSchema.parse(input);
      if (parsed.acao === "cancelar" && !parsed.motivo) {
        throw new Error("Informe o motivo do cancelamento.");
      }
      const { data, error } = await supabase.rpc("membership_update_status", {
        p_subscription_id: parsed.subscriptionId,
        p_status: STATUS_POR_ACAO[parsed.acao],
        p_reason: parsed.motivo ?? null,
      });
      if (error) throw error;
      const statusParsed = z
        .enum(MEMBERSHIP_SUBSCRIPTION_STATUSES)
        .safeParse(
          typeof data === "string"
            ? data
            : (data as { status?: unknown } | null)?.status,
        );
      const status: MembershipSubscriptionStatus = statusParsed.success
        ? statusParsed.data
        : parsed.acao === "pausar"
          ? "pausada"
          : parsed.acao === "cancelar"
            ? "cancelada"
            : "ativa";
      return { status };
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: MEMBERSHIP_SUBSCRIPTIONS_KEY,
      });
      void queryClient.invalidateQueries({ queryKey: MEMBERSHIP_CHARGES_KEY });
    },
  });
}

export const regularizarInputSchema = z.object({
  subscriptionId: z.string().uuid("Assinatura inválida."),
});

export type RegularizarInput = z.infer<typeof regularizarInputSchema>;

/**
 * Regularizar inadimplente: gera a cobrança PIX do ciclo via
 * `membership_charge_cycle` (idempotente por ciclo — nunca duplica pendente;
 * webhook pago devolve a subscription para `ativa`, ADR-04). Erro de
 * duplicidade do servidor é tratado como sucesso idempotente.
 */
export function useRegularizarAssinatura() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: RegularizarInput) => {
      const parsed = regularizarInputSchema.parse(input);
      const { data, error } = await supabase.rpc("membership_charge_cycle", {
        p_subscription_id: parsed.subscriptionId,
      });
      if (error) {
        const msg = error.message.toLowerCase();
        if (msg.includes("duplicate") || msg.includes("already exists")) {
          return { chargeId: null as string | null, duplicada: true as const };
        }
        throw error;
      }
      const chargeId =
        typeof data === "string"
          ? data
          : ((data as { id?: unknown } | null)?.id as string | undefined) ??
            null;
      return { chargeId, duplicada: false as const };
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: MEMBERSHIP_SUBSCRIPTIONS_KEY,
      });
      void queryClient.invalidateQueries({ queryKey: MEMBERSHIP_CHARGES_KEY });
    },
  });
}

export const reenviarCobrancaInputSchema = z.object({
  customerId: z.string().uuid("Cliente inválido."),
  subscriptionId: z.string().uuid("Assinatura inválida."),
  customerOptIn: z.boolean(),
});

export type ReenviarCobrancaInput = z.infer<typeof reenviarCobrancaInputSchema>;

/**
 * Reenvio manual da cobrança (`cobranca`, template da régua existente).
 * Sem opt-in → recusa client-side com explicação (nunca dispara request;
 * a trava real é server-side). Fora da janela de 24h a Edge usa template
 * aprovado — a UI não decide o formato.
 */
export function useReenviarCobrancaAssinatura() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: ReenviarCobrancaInput) => {
      const parsed = reenviarCobrancaInputSchema.parse(input);
      if (!parsed.customerOptIn) {
        throw new Error(
          "Cliente sem consentimento de WhatsApp. Peça o opt-in antes de reenviar.",
        );
      }
      const { data, error } = await supabase.functions.invoke("whatsapp", {
        body: {
          action: "send",
          template: "cobranca",
          customerId: parsed.customerId,
          metadata: { subscription_id: parsed.subscriptionId },
        },
      });
      if (error) throw new Error(mapWhatsAppError(error));
      return data as { message_id?: string | null };
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["messages"] });
    },
  });
}

export type { MembershipChargeStatus, MembershipSubscriptionStatus };
