/**
 * Tipos de estado locais do fechamento de pagamento (ADR-004 §9/§10).
 * Nada aqui é persistido; `cashReceivedCents` e `changeCents` são estado de
 * sessão (troco nunca vai ao body).
 */

import type {
  AppointmentSettlement,
  PaymentMethod,
  PaymentStatus,
  PixCharge,
} from "@/types/payments";

export interface PaymentLineDraft {
  /** Id local; nunca vai ao servidor. */
  key: string;
  method: PaymentMethod;
  amountCents: number;
  tipCents: number;
  /** Só dinheiro; não persiste. */
  cashReceivedCents: number;
  /** Só cartões/PIX da maquininha; obrigatório para registrar. */
  cardConfirmed: boolean;
}

export interface ReceiptLine {
  method: PaymentMethod;
  amountCents: number;
  tipCents: number;
}

export interface ReceiptData {
  customerName: string | null;
  serviceName: string | null;
  professionalName: string | null;
  totalCents: number;
  paidCents: number;
  tipCents: number;
  /** Somente quando calculado nesta sessão. */
  changeCents: number | null;
  status: PaymentStatus;
  issuedAt: string;
  lines: ReceiptLine[];
}

export type CapturePhase =
  | { kind: "loading_settlement" }
  | { kind: "editing" }
  | { kind: "confirm_partial"; draft: PaymentLineDraft[] }
  | { kind: "confirm_register_later" }
  | { kind: "confirm_discard"; pendingAction: "close" | "leave" }
  | { kind: "submitting"; reason: "register" | "register_later" }
  | { kind: "awaiting_pix"; charge: PixCharge }
  | {
      kind: "gateway_error";
      settlement: AppointmentSettlement;
      pixAmountCents: number;
      persisted: boolean;
    }
  | { kind: "success"; settlement: AppointmentSettlement; receipt: ReceiptData }
  | { kind: "error"; code: string };

export type SettlementPhase =
  | { kind: "ready" }
  | { kind: "qr"; chargeId: string }
  | { kind: "confirm_cancel"; chargeId: string; force: boolean }
  | { kind: "confirm_manual"; chargeId: string }
  | { kind: "confirm_void"; paymentId: string };
