/**
 * Matemática pura do fechamento (ADR-004 §9.6). Sem I/O, sem relógio, sem
 * float: todos os valores são centavos inteiros.
 */

import type { PaymentStatus } from "@/types/payments";
import type { PaymentLineDraft } from "@/app/agenda/pagamentos/payment-types";
import { CARD_PAYMENT_METHODS } from "@/types/payments";

export function sumLineAmounts(
  lines: ReadonlyArray<Pick<PaymentLineDraft, "amountCents">>,
): number {
  return lines.reduce((total, line) => total + (line.amountCents || 0), 0);
}

export function sumLineTips(
  lines: ReadonlyArray<Pick<PaymentLineDraft, "tipCents">>,
): number {
  return lines.reduce((total, line) => total + (line.tipCents || 0), 0);
}

/** Falta quitar depois do rascunho (nunca negativo). */
export function computeDraftRemainingCents(
  remainingCents: number,
  lines: ReadonlyArray<Pick<PaymentLineDraft, "amountCents">>,
): number {
  return Math.max(remainingCents - sumLineAmounts(lines), 0);
}

/** Troco de uma linha de dinheiro (nunca negativo). */
export function computeChangeCents(
  cashReceivedCents: number,
  amountCents: number,
): number {
  return Math.max(cashReceivedCents - amountCents, 0);
}

export interface DraftValidationInput {
  totalCents: number;
  remainingCents: number;
  lines: ReadonlyArray<PaymentLineDraft>;
  mode: "close" | "register";
}

export interface DraftValidation {
  draftCents: number;
  draftRemainingCents: number;
  tipCents: number;
  totalZero: boolean;
  exceeds: boolean;
  cashShort: boolean;
  cardNotConfirmed: boolean;
  requiresPartialConfirm: boolean;
  canSubmit: boolean;
}

/**
 * Valida o rascunho local. A fonte da verdade continua sendo o servidor;
 * este cálculo é UX (bloqueia cedo o que o RPC recusaria).
 */
export function validateDraft(input: DraftValidationInput): DraftValidation {
  const draftCents = sumLineAmounts(input.lines);
  const tipCents = sumLineTips(input.lines);
  const totalZero = input.totalCents === 0;
  const exceeds = draftCents > input.remainingCents;
  const cashShort = input.lines.some(
    (line) =>
      line.method === "dinheiro" &&
      line.cashReceivedCents > 0 &&
      line.cashReceivedCents < line.amountCents,
  );
  const cardNotConfirmed = input.lines.some(
    (line) => CARD_PAYMENT_METHODS.includes(line.method) && !line.cardConfirmed,
  );
  const hasPositiveLine = draftCents > 0;
  const requiresPartialConfirm =
    hasPositiveLine && draftCents < input.remainingCents;

  const canSubmit =
    !totalZero &&
    hasPositiveLine &&
    !exceeds &&
    !cashShort &&
    !cardNotConfirmed &&
    (input.mode === "close" || hasPositiveLine);

  return {
    draftCents,
    draftRemainingCents: Math.max(input.remainingCents - draftCents, 0),
    tipCents,
    totalZero,
    exceeds,
    cashShort,
    cardNotConfirmed,
    requiresPartialConfirm,
    canSubmit,
  };
}

export interface DerivePaymentStatusInput {
  totalCents: number;
  paidCents: number;
  reservedCents: number;
}

/**
 * Reproduz literalmente a precedência da ADR-002 (§1.1):
 * total zero → quitado; pago cobre → quitado; existe cobrança pendente →
 * aguardando_pix; nada pago → sem_pagamento; senão parcial.
 */
export function derivePaymentStatus(
  input: DerivePaymentStatusInput,
): PaymentStatus {
  const { totalCents, paidCents, reservedCents } = input;
  if (totalCents === 0 && paidCents === 0) return "quitado";
  if (paidCents >= totalCents) return "quitado";
  if (reservedCents > 0) return "aguardando_pix";
  if (paidCents === 0) return "sem_pagamento";
  return "parcial";
}

/** Status a partir do rascunho (preview local antes do commit). */
export function paymentStatusOfLines(
  totalCents: number,
  lines: ReadonlyArray<Pick<PaymentLineDraft, "amountCents">>,
): PaymentStatus {
  return derivePaymentStatus({
    totalCents,
    paidCents: sumLineAmounts(lines),
    reservedCents: 0,
  });
}
