/**
 * Membership (ADR-04 Fase 5) — tipos + leitura RLS.
 *
 * Recorrência do tenant: planos (`membership_plans`), adesões
 * (`membership_subscriptions`) e cobranças por ciclo (`membership_charges`).
 * Distinto do catálogo SaaS `plans` (assinatura do tenant no Atlas) e do ledger
 * `appointment_payments` (receita de atendimento — membership nunca entra lá;
 * categoria própria DRE em ADR-09).
 *
 * Leitura: RLS admin-only (recepção/profissional sem SELECT; cross-tenant nega).
 * Escrita: só via RPCs (`membership_subscribe`, `membership_charge_cycle`,
 * `membership_update_status`) ou service_role (webhook/cron). Este módulo não
 * escreve — só tipa e lê o que a RLS permite.
 */

import { z } from "zod";

export const MEMBERSHIP_BILLING_PERIODS = ["mensal", "trimestral", "anual"] as const;
export type MembershipBillingPeriod = (typeof MEMBERSHIP_BILLING_PERIODS)[number];

export const MEMBERSHIP_SUBSCRIPTION_STATUSES = [
  "ativa",
  "inadimplente",
  "pausada",
  "cancelada",
] as const;
export type MembershipSubscriptionStatus =
  (typeof MEMBERSHIP_SUBSCRIPTION_STATUSES)[number];

export const MEMBERSHIP_CHARGE_STATUSES = [
  "pendente",
  "pago",
  "vencido",
  "cancelado",
] as const;
export type MembershipChargeStatus = (typeof MEMBERSHIP_CHARGE_STATUSES)[number];

export interface MembershipPlan {
  id: string;
  tenant_id: string;
  name: string;
  /** Valor do ciclo em centavos inteiros. */
  amount_cents: number;
  billing_period: MembershipBillingPeriod;
  active: boolean;
  created_at: string;
}

export interface MembershipSubscription {
  id: string;
  tenant_id: string;
  customer_id: string;
  plan_id: string;
  status: MembershipSubscriptionStatus;
  next_charge_at: string | null;
  created_at: string;
}

export interface MembershipCharge {
  id: string;
  tenant_id: string;
  subscription_id: string;
  /** Ciclo de competência `YYYY-MM`. */
  cycle_ref: string;
  amount_cents: number;
  status: MembershipChargeStatus;
  asaas_payment_id: string | null;
  due_at: string;
  paid_at: string | null;
  created_at: string;
}

/** `YYYY-MM` — rejeita ciclo malformado antes de qualquer request. */
export const CycleRefSchema = z
  .string()
  .regex(/^[0-9]{4}-[0-9]{2}$/, "Ciclo inválido (esperado YYYY-MM).");

/** Linha de cobrança com o plano resolvido (lista da UI, ADR-05 consome). */
export interface MembershipChargeRow extends MembershipCharge {
  plan_name: string;
  customer_name: string;
}
