/**
 * Contratos de wire do fechamento de pagamento (ADR-004, consumindo ADR-002).
 *
 * Tipos puros — **sem zod** (a validação de runtime vive nos hooks). Dinheiro
 * sempre em centavos inteiros; nenhum float atravessa esta camada.
 */

import type { AppointmentStatus } from "@/types/domain";

export const PAYMENT_METHODS = [
  "dinheiro",
  "cartao_credito",
  "cartao_debito",
  "pix_sistema",
  "pix_maquininha",
] as const;

export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

/** Formas que exigem confirmação explícita na maquininha (sem QR/gateway). */
export const CARD_PAYMENT_METHODS: ReadonlyArray<PaymentMethod> = [
  "cartao_credito",
  "cartao_debito",
  "pix_maquininha",
];

export const PAYMENT_STATUSES = [
  "sem_pagamento",
  "parcial",
  "quitado",
  "aguardando_pix",
] as const;

export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export type PaymentSource = "manual" | "asaas";

/** Linha do ledger `appointment_payments` projetada pelo settlement. */
export interface SettlementPayment {
  id: string;
  method: PaymentMethod;
  amount_cents: number;
  tip_cents: number;
  source: PaymentSource;
  received_at: string;
  voided_at: string | null;
  /** Recortado pelo servidor: só admin recebe o motivo. */
  void_reason: string | null;
}

/** Cobrança PIX pendente ativa do atendimento. */
export interface PendingCharge {
  id: string;
  amount_cents: number;
  expires_at: string | null;
  pix_qr_code: string | null;
  pix_copy_paste: string | null;
}

/** Cobrança vencida/cancelada que ainda pode ser reemitida. */
export interface StaleCharge {
  id: string;
  amount_cents: number;
  status: "expirado" | "cancelado" | "pendente";
  expires_at: string | null;
}

/** Flags de autorização devolvidas pelo servidor (nunca calculadas no cliente). */
export interface SettlementPermissions {
  can_register: boolean;
  can_cancel_charge: boolean;
  can_confirm_manual: boolean;
  can_void: boolean;
  can_view_qr: boolean;
  can_reissue_pix: boolean;
}

export interface SettlementAppointment {
  id: string;
  status: AppointmentStatus;
  starts_at: string;
  customer_name: string | null;
  service_name: string | null;
  professional_name: string | null;
  total_cents: number;
}

/** Retorno de `get-appointment-settlement`. */
export interface AppointmentSettlement {
  appointment: SettlementAppointment;
  payments: SettlementPayment[];
  pending_charges: PendingCharge[];
  stale_charges: StaleCharge[];
  total_paid_cents: number;
  tip_cents: number;
  reserved_cents: number;
  remaining_cents: number;
  payment_status: PaymentStatus;
  permissions: SettlementPermissions;
}

/**
 * Resumo financeiro admin da RPC `financial_summary` (ADR-005).
 * Chaves congeladas: espelham 1:1 o `jsonb_build_object` da migration.
 * Receita SÓ do ledger; `charges.pago` nunca aparece aqui.
 */
export interface FinancialSummary {
  period: { from: string; to: string };
  received_service_cents: number;
  received_tips_cents: number;
  received_total_cents: number;
  receivable_cents: number;
  open_cents: number;
  by_method: Array<{
    method: PaymentMethod;
    amount_cents: number;
    tip_cents: number;
    count: number;
  }>;
}

/**
 * Linha da aba Recebimentos (ADR-005 §3): leitura direta do ledger sob RLS
 * admin com embed de cliente/operador. `operator_name` é PII operacional:
 * nunca vai para log nem exportação (não há exportação).
 */
export interface ReceivableRow {
  id: string;
  received_at: string;
  customer_name: string | null;
  method: PaymentMethod;
  amount_cents: number;
  tip_cents: number;
  source: "manual" | "asaas";
  operator_name: string | null;
  voided_at: string | null;
  void_reason: string | null;
  charge_id: string | null;
}

/**
 * Cobrança PIX normalizada para a UI. O contrato ubíquo (`create-charge`)
 * devolve `charge_id`; o hook normaliza para `id` (tipo único).
 */
export interface PixCharge {
  id: string;
  amount_cents: number;
  pix_qr_code: string | null;
  pix_copy_paste: string | null;
  expires_at: string | null;
}
