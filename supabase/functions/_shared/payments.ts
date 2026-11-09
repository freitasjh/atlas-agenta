// Leitura financeira escopada de UM atendimento (ADR-002 §5.5).
// Números vêm exclusivamente de `appointment_payment_summary`; nada de aritmética
// monetária em TypeScript.
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import type { Identity } from "./identity.ts";
import { ApiError } from "./http.ts";

export const PAYMENT_METHODS = [
  "dinheiro",
  "cartao_credito",
  "cartao_debito",
  "pix_sistema",
  "pix_maquininha",
] as const;

export interface PaymentSummary {
  price_cents: number;
  total_paid_cents: number;
  tip_cents: number;
  reserved_cents: number;
  remaining_cents: number;
  payment_status: string;
  pending_charge_id: string | null;
  pending_charge_amount_cents: number;
}

export async function readSummary(
  service: SupabaseClient,
  tenantId: string,
  appointmentId: string,
): Promise<PaymentSummary | null> {
  const { data, error } = await service.rpc("appointment_payment_summary", {
    p_tenant_id: tenantId,
    p_appointment_id: appointmentId,
  });
  if (error) throw new ApiError(500, "INTERNAL");
  if (data === null || data === undefined) return null;
  return data as PaymentSummary;
}

interface PaymentRow {
  id: string;
  method: string;
  amount_cents: number;
  tip_cents: number;
  source: string;
  received_at: string;
  voided_at: string | null;
  void_reason: string | null;
}

interface ChargeRow {
  id: string;
  amount_cents: number;
  status: string;
  expires_at: string | null;
  pix_qr_code: string | null;
  pix_copy_paste: string | null;
}

export interface PendingCharge {
  id: string;
  amount_cents: number;
  expires_at: string | null;
  pix_qr_code: string | null;
  pix_copy_paste: string | null;
}

function isActivePending(charge: ChargeRow, now: number): boolean {
  if (charge.expires_at === null) return true;
  const expires = Date.parse(charge.expires_at);
  return Number.isNaN(expires) || expires > now;
}

/** Cobrança pendente ATIVA de um atendimento (nunca expirada/cancelada/paga). */
export async function loadActivePendingCharge(
  service: SupabaseClient,
  tenantId: string,
  appointmentId: string,
): Promise<PendingCharge | null> {
  const { data, error } = await service
    .from("charges")
    .select("id, amount_cents, status, expires_at, pix_qr_code, pix_copy_paste")
    .eq("tenant_id", tenantId)
    .eq("appointment_id", appointmentId)
    .eq("status", "pendente")
    .order("created_at", { ascending: false })
    .maybeSingle();
  if (error) throw new ApiError(500, "INTERNAL");
  if (!data) return null;
  const charge = data as Record<string, unknown>;
  const row: ChargeRow = {
    id: String(charge.id),
    amount_cents: Number(charge.amount_cents ?? 0),
    status: String(charge.status ?? ""),
    expires_at: (charge.expires_at as string | null) ?? null,
    pix_qr_code: (charge.pix_qr_code as string | null) ?? null,
    pix_copy_paste: (charge.pix_copy_paste as string | null) ?? null,
  };
  if (row.status !== "pendente" || !isActivePending(row, Date.now())) return null;
  return {
    id: row.id,
    amount_cents: row.amount_cents,
    expires_at: row.expires_at,
    pix_qr_code: row.pix_qr_code,
    pix_copy_paste: row.pix_copy_paste,
  };
}

export async function loadSettlement(
  service: SupabaseClient,
  identity: Identity,
  appointmentId: string,
): Promise<Record<string, unknown>> {
  const { data: appointment, error: appointmentError } = await service
    .from("appointments")
    .select("id, status, origin, starts_at, price_cents, customer_id, service_id, professional_id")
    .eq("tenant_id", identity.tenantId)
    .eq("id", appointmentId)
    .maybeSingle();

  if (appointmentError) throw new ApiError(500, "INTERNAL");
  if (!appointment) throw new ApiError(404, "APPOINTMENT_NOT_FOUND");

  const [customerResult, serviceResult, professionalResult, paymentsResult, chargesResult] =
    await Promise.all([
      service
        .from("customers")
        .select("name")
        .eq("tenant_id", identity.tenantId)
        .eq("id", appointment.customer_id)
        .maybeSingle(),
      service
        .from("services")
        .select("name")
        .eq("tenant_id", identity.tenantId)
        .eq("id", appointment.service_id)
        .maybeSingle(),
      service
        .from("professionals")
        .select("name")
        .eq("tenant_id", identity.tenantId)
        .eq("id", appointment.professional_id)
        .maybeSingle(),
      service
        .from("appointment_payments")
        .select("id, method, amount_cents, tip_cents, source, received_at, voided_at, void_reason")
        .eq("tenant_id", identity.tenantId)
        .eq("appointment_id", appointmentId)
        .order("received_at", { ascending: true }),
      service
        .from("charges")
        .select("id, amount_cents, status, expires_at, pix_qr_code, pix_copy_paste")
        .eq("tenant_id", identity.tenantId)
        .eq("appointment_id", appointmentId)
        .order("created_at", { ascending: false }),
    ]);

  for (const result of [
    customerResult,
    serviceResult,
    professionalResult,
    paymentsResult,
    chargesResult,
  ]) {
    if (result.error) throw new ApiError(500, "INTERNAL");
  }

  const summary = await readSummary(service, identity.tenantId, appointmentId);
  if (!summary) throw new ApiError(404, "APPOINTMENT_NOT_FOUND");

  const payments = (paymentsResult.data ?? []) as PaymentRow[];
  const now = Date.now();
  const allCharges = (chargesResult.data ?? []) as ChargeRow[];
  const pendingCharges = allCharges.filter(
    (charge) => charge.status === "pendente" && isActivePending(charge, now),
  );
  // Stale = expirado/cancelado (ou pendente vencida) com valor: pode ser cancelado
  // e habilita a reemissão do PIX na MESMA linha. Pago nunca entra aqui.
  const staleCharges = allCharges.filter((charge) => {
    if (charge.amount_cents <= 0) return false;
    if (charge.status === "expirado" || charge.status === "cancelado") return true;
    return charge.status === "pendente" && !isActivePending(charge, now);
  });
  const hasPaidCharge = allCharges.some((charge) => charge.status === "pago");

  const isAdmin = identity.role === "admin";
  const isReceptionist = identity.role === "receptionist";
  const canManageCharges = identity.role === "admin" || identity.role === "receptionist";
  const hasPending = pendingCharges.length > 0;
  // Walk-in (PDV): recepção vê QR em `concluido` só para venda de balcão
  // (ADR-22). Agendado concluído para recepção continua sem QR.
  const isWalkInConcluido =
    (appointment as { origin?: string }).origin === "walk_in" &&
    appointment.status === "concluido";
  const canViewQr =
    hasPending &&
    (isAdmin || appointment.status === "em_atendimento" || (isReceptionist && isWalkInConcluido));
  const canRegister =
    (identity.role === "admin" || identity.role === "receptionist" || identity.role === "professional") &&
    (appointment.status === "em_atendimento" || appointment.status === "concluido");
  const permissions = {
    can_register: canRegister,
    can_cancel_charge: canManageCharges && (hasPending || staleCharges.length > 0),
    can_confirm_manual: isAdmin && hasPending,
    can_void: isAdmin && payments.some((payment) => payment.voided_at === null),
    can_view_qr: canViewQr,
    can_reissue_pix: staleCharges.length > 0 && !hasPaidCharge,
  };

  return {
    appointment: {
      id: appointment.id,
      status: appointment.status,
      origin: (appointment as { origin?: string }).origin ?? "agendado",
      starts_at: appointment.starts_at,
      customer_name: customerResult.data?.name ?? null,
      service_name: serviceResult.data?.name ?? null,
      professional_name: professionalResult.data?.name ?? null,
      total_cents: appointment.price_cents,
    },
    payments: payments.map((payment) => ({
      id: payment.id,
      method: payment.method,
      amount_cents: payment.amount_cents,
      tip_cents: payment.tip_cents,
      source: payment.source,
      received_at: payment.received_at,
      voided_at: payment.voided_at,
      void_reason: isAdmin ? payment.void_reason : null,
    })),
    pending_charges: pendingCharges.map((charge) => ({
      id: charge.id,
      amount_cents: charge.amount_cents,
      expires_at: charge.expires_at,
      pix_qr_code: canViewQr ? charge.pix_qr_code : null,
      pix_copy_paste: canViewQr ? charge.pix_copy_paste : null,
    })),
    stale_charges: staleCharges.map((charge) => ({
      id: charge.id,
      amount_cents: charge.amount_cents,
      status: charge.status,
      expires_at: charge.expires_at,
    })),
    total_paid_cents: summary.total_paid_cents,
    tip_cents: summary.tip_cents,
    reserved_cents: summary.reserved_cents,
    remaining_cents: summary.remaining_cents,
    payment_status: summary.payment_status,
    permissions,
  };
}
