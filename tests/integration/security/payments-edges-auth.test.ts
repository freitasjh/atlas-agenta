// Matriz de autorização e PII das Edge Functions de pagamento (ADR-002; RF-07, RF-08,
// RF-12, RF-13, RF-16). Cada caso negativo também confere o estado do banco.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { serviceClient } from "../helpers/clients.ts";
import { callFunction } from "../helpers/functions.ts";
import {
  cleanupPaymentFixtures,
  createPaymentsTenant,
  seedAppointment,
  seedCharge,
  seedPayment,
  type PaymentsTenant,
} from "../helpers/payments-fixtures.ts";
import { sql } from "../helpers/sql.ts";
import { createTenantMember, deleteTestUsers, type TestUser } from "../helpers/users.ts";

let tenantA: PaymentsTenant;
let tenantB: PaymentsTenant;
let receptionist: TestUser;
let professional: TestUser;
let otherProfessional: TestUser;
let inactive: TestUser;

function ledgerCount(tenantId: string, appointmentId: string): number {
  return Number(
    sql(
      `select count(*) from public.appointment_payments
        where tenant_id = :'tenant'::uuid and appointment_id = :'appointment'::uuid;`,
      { tenant: tenantId, appointment: appointmentId },
    ),
  );
}

async function statusOf(appointmentId: string): Promise<string | null> {
  const { data } = await serviceClient()
    .from("appointments")
    .select("status")
    .eq("id", appointmentId)
    .maybeSingle();
  return (data?.status as string | undefined) ?? null;
}

beforeAll(async () => {
  tenantA = await createPaymentsTenant("payments-edges-a");
  tenantB = await createPaymentsTenant("payments-edges-b");
  receptionist = await createTenantMember(tenantA.tenantId, "receptionist", "payments-edges-recep");
  professional = await createTenantMember(tenantA.tenantId, "professional", "payments-edges-prof");
  otherProfessional = await createTenantMember(
    tenantA.tenantId,
    "professional",
    "payments-edges-prof-2",
  );
  inactive = await createTenantMember(tenantA.tenantId, "receptionist", "payments-edges-inactive");
  await serviceClient().from("profiles").update({ active: false }).eq("id", inactive.id);
});

afterAll(async () => {
  await cleanupPaymentFixtures([tenantA.tenantId, tenantB.tenantId]);
  await deleteTestUsers();
});

describe("RF-13 corpo estrito e identidade", () => {
  it("body com tenant_id => 400 INVALID_BODY e nada escrito", async () => {
    const fixture = await seedAppointment(tenantA.tenantId, {
      status: "em_atendimento",
      priceCents: 10_000,
    });
    const response = await callFunction("register-appointment-payments", {
      token: tenantA.admin.accessToken,
      body: {
        appointment_id: fixture.appointmentId,
        idempotency_key: randomUUID(),
        close_appointment: true,
        payments: [],
        tenant_id: tenantA.tenantId,
      },
    });
    expect(response.status).toBe(400);
    expect(response.json?.code).toBe("INVALID_BODY");
    expect(ledgerCount(tenantA.tenantId, fixture.appointmentId)).toBe(0);
    expect(await statusOf(fixture.appointmentId)).toBe("em_atendimento");
  });

  it("body com role => 400 INVALID_BODY; idempotency_key ausente => 400 IDEMPOTENCY_KEY_REQUIRED", async () => {
    const fixture = await seedAppointment(tenantA.tenantId, {
      status: "em_atendimento",
      priceCents: 10_000,
    });
    const withRole = await callFunction("register-appointment-payments", {
      token: tenantA.admin.accessToken,
      body: {
        appointment_id: fixture.appointmentId,
        idempotency_key: randomUUID(),
        close_appointment: true,
        payments: [],
        role: "admin",
      },
    });
    expect(withRole.status).toBe(400);
    expect(withRole.json?.code).toBe("INVALID_BODY");

    const missingKey = await callFunction("register-appointment-payments", {
      token: tenantA.admin.accessToken,
      body: {
        appointment_id: fixture.appointmentId,
        close_appointment: true,
        payments: [],
      },
    });
    expect(missingKey.status).toBe(400);
    expect(missingKey.json?.code).toBe("IDEMPOTENCY_KEY_REQUIRED");
    expect(ledgerCount(tenantA.tenantId, fixture.appointmentId)).toBe(0);
  });

  it("sem JWT => 401 UNAUTHENTICATED", async () => {
    const fixture = await seedAppointment(tenantA.tenantId, { status: "em_atendimento" });
    const response = await callFunction("get-appointment-settlement", {
      body: { appointment_id: fixture.appointmentId },
    });
    expect(response.status).toBe(401);
  });

  it("usuário inactive => 403 FORBIDDEN em todos os endpoints", async () => {
    const fixture = await seedAppointment(tenantA.tenantId, {
      status: "em_atendimento",
      priceCents: 10_000,
    });
    const chargeId = await seedCharge({
      tenantId: tenantA.tenantId,
      appointmentId: fixture.appointmentId,
      amountCents: 3_000,
    });
    const calls = [
      callFunction("register-appointment-payments", {
        token: inactive.accessToken,
        body: {
          appointment_id: fixture.appointmentId,
          idempotency_key: randomUUID(),
          close_appointment: true,
          payments: [],
        },
      }),
      callFunction("get-appointment-settlement", {
        token: inactive.accessToken,
        body: { appointment_id: fixture.appointmentId },
      }),
      callFunction("cancel-charge", {
        token: inactive.accessToken,
        body: { charge_id: chargeId },
      }),
      callFunction("confirm-charge-manual", {
        token: inactive.accessToken,
        body: { charge_id: chargeId },
      }),
      callFunction("void-appointment-payment", {
        token: inactive.accessToken,
        body: { payment_id: randomUUID(), reason: "motivo" },
      }),
    ];
    for (const response of await Promise.all(calls)) {
      expect(response.status).toBe(403);
      expect(response.json?.code).toBe("FORBIDDEN");
    }
    expect(ledgerCount(tenantA.tenantId, fixture.appointmentId)).toBe(0);
  });
});

describe("RF-07/RF-13 register-appointment-payments", () => {
  it("admin registra lote e conclui; recepção também pode registrar", async () => {
    const adminFixture = await seedAppointment(tenantA.tenantId, {
      status: "em_atendimento",
      priceCents: 10_000,
    });
    const adminResponse = await callFunction("register-appointment-payments", {
      token: tenantA.admin.accessToken,
      body: {
        appointment_id: adminFixture.appointmentId,
        idempotency_key: randomUUID(),
        close_appointment: true,
        payments: [{ method: "dinheiro", amount_cents: 10_000 }],
      },
    });
    expect(adminResponse.status).toBe(200);
    const adminBody = adminResponse.json as Record<string, Record<string, unknown>>;
    expect(adminBody.settlement?.payment_status).toBe("quitado");
    expect(await statusOf(adminFixture.appointmentId)).toBe("concluido");

    const receptionFixture = await seedAppointment(tenantA.tenantId, {
      status: "em_atendimento",
      priceCents: 5_000,
    });
    const receptionResponse = await callFunction("register-appointment-payments", {
      token: receptionist.accessToken,
      body: {
        appointment_id: receptionFixture.appointmentId,
        idempotency_key: randomUUID(),
        close_appointment: true,
        payments: [{ method: "cartao_debito", amount_cents: 5_000 }],
      },
    });
    expect(receptionResponse.status).toBe(200);
    expect(ledgerCount(tenantA.tenantId, receptionFixture.appointmentId)).toBe(1);
  });

  it("profissional só o próprio; alheio => 403 PROFESSIONAL_NOT_OWNER sem escrita", async () => {
    const own = await seedAppointment(tenantA.tenantId, {
      status: "em_atendimento",
      priceCents: 4_000,
      professionalProfileId: professional.id,
    });
    const ownResponse = await callFunction("register-appointment-payments", {
      token: professional.accessToken,
      body: {
        appointment_id: own.appointmentId,
        idempotency_key: randomUUID(),
        close_appointment: true,
        payments: [{ method: "dinheiro", amount_cents: 4_000 }],
      },
    });
    expect(ownResponse.status).toBe(200);
    expect(ledgerCount(tenantA.tenantId, own.appointmentId)).toBe(1);

    const other = await seedAppointment(tenantA.tenantId, {
      status: "em_atendimento",
      priceCents: 4_000,
      professionalProfileId: otherProfessional.id,
    });
    const denied = await callFunction("register-appointment-payments", {
      token: professional.accessToken,
      body: {
        appointment_id: other.appointmentId,
        idempotency_key: randomUUID(),
        close_appointment: true,
        payments: [{ method: "dinheiro", amount_cents: 4_000 }],
      },
    });
    expect(denied.status).toBe(403);
    expect(denied.json?.code).toBe("PROFESSIONAL_NOT_OWNER");
    expect(ledgerCount(tenantA.tenantId, other.appointmentId)).toBe(0);
    expect(await statusOf(other.appointmentId)).toBe("em_atendimento");
  });

  it("tenant B operando atendimento do A => 404 e nada escrito", async () => {
    const fixture = await seedAppointment(tenantA.tenantId, {
      status: "em_atendimento",
      priceCents: 10_000,
    });
    const response = await callFunction("register-appointment-payments", {
      token: tenantB.admin.accessToken,
      body: {
        appointment_id: fixture.appointmentId,
        idempotency_key: randomUUID(),
        close_appointment: true,
        payments: [],
      },
    });
    expect(response.status).toBe(404);
    expect(response.json?.code).toBe("APPOINTMENT_NOT_FOUND");
    expect(ledgerCount(tenantA.tenantId, fixture.appointmentId)).toBe(0);
  });
});

describe("RF-08/RF-12 get-appointment-settlement", () => {
  it("admin em atendimento vê settlement completo, QR e permissões derivadas", async () => {
    const fixture = await seedAppointment(tenantA.tenantId, {
      status: "em_atendimento",
      priceCents: 10_000,
      professionalProfileId: professional.id,
    });
    await seedPayment({
      tenantId: tenantA.tenantId,
      appointmentId: fixture.appointmentId,
      amountCents: 6_000,
    });
    await seedCharge({
      tenantId: tenantA.tenantId,
      appointmentId: fixture.appointmentId,
      amountCents: 3_000,
      pixQrCode: "qr-test",
      pixCopyPaste: "copy-test",
    });

    const response = await callFunction("get-appointment-settlement", {
      token: tenantA.admin.accessToken,
      body: { appointment_id: fixture.appointmentId },
    });
    expect(response.status).toBe(200);
    const body = response.json as Record<string, any>;
    expect(body.total_paid_cents).toBe(6_000);
    expect(body.reserved_cents).toBe(3_000);
    expect(body.remaining_cents).toBe(1_000);
    expect(body.payment_status).toBe("aguardando_pix");
    expect(body.pending_charges[0].pix_qr_code).toBe("qr-test");
    expect(body.permissions).toMatchObject({
      can_register: true,
      can_cancel_charge: true,
      can_confirm_manual: true,
      can_view_qr: true,
    });
  });

  it("recepção em concluído não vê QR nem void_reason, mas vê voided_at", async () => {
    const fixture = await seedAppointment(tenantA.tenantId, {
      status: "concluido",
      priceCents: 10_000,
    });
    await seedPayment({
      tenantId: tenantA.tenantId,
      appointmentId: fixture.appointmentId,
      amountCents: 6_000,
    });
    await seedPayment({
      tenantId: tenantA.tenantId,
      appointmentId: fixture.appointmentId,
      amountCents: 1_000,
      voidedAt: new Date().toISOString(),
      voidedBy: tenantA.admin.id,
      voidReason: "motivo sensível",
    });
    await seedCharge({
      tenantId: tenantA.tenantId,
      appointmentId: fixture.appointmentId,
      amountCents: 3_000,
      pixQrCode: "qr-hidden",
      pixCopyPaste: "copy-hidden",
    });

    const receptionResponse = await callFunction("get-appointment-settlement", {
      token: receptionist.accessToken,
      body: { appointment_id: fixture.appointmentId },
    });
    expect(receptionResponse.status).toBe(200);
    const receptionBody = receptionResponse.json as Record<string, any>;
    expect(receptionBody.pending_charges[0].pix_qr_code).toBeNull();
    expect(receptionBody.pending_charges[0].pix_copy_paste).toBeNull();
    expect(receptionBody.permissions.can_view_qr).toBe(false);
    const voided = receptionBody.payments.find((payment: any) => payment.voided_at !== null);
    expect(voided.voided_at).toBeTruthy();
    expect(voided.void_reason).toBeNull();

    const adminResponse = await callFunction("get-appointment-settlement", {
      token: tenantA.admin.accessToken,
      body: { appointment_id: fixture.appointmentId },
    });
    const adminBody = adminResponse.json as Record<string, any>;
    expect(adminBody.pending_charges[0].pix_qr_code).toBe("qr-hidden");
    expect(adminBody.permissions.can_view_qr).toBe(true);
    const adminVoided = adminBody.payments.find((payment: any) => payment.voided_at !== null);
    expect(adminVoided.void_reason).toBe("motivo sensível");
  });

  it("profissional alheio => 403; outro tenant => 404; leitura direta sob authenticated => 0 linhas", async () => {
    const fixture = await seedAppointment(tenantA.tenantId, {
      status: "em_atendimento",
      professionalProfileId: otherProfessional.id,
    });
    await seedPayment({
      tenantId: tenantA.tenantId,
      appointmentId: fixture.appointmentId,
      amountCents: 1_000,
    });

    const denied = await callFunction("get-appointment-settlement", {
      token: professional.accessToken,
      body: { appointment_id: fixture.appointmentId },
    });
    expect(denied.status).toBe(403);
    expect(denied.json?.code).toBe("PROFESSIONAL_NOT_OWNER");

    const foreign = await callFunction("get-appointment-settlement", {
      token: tenantB.admin.accessToken,
      body: { appointment_id: fixture.appointmentId },
    });
    expect(foreign.status).toBe(404);

    const direct = await professional.client
      .from("appointment_payments")
      .select("id")
      .eq("appointment_id", fixture.appointmentId);
    expect(direct.error).toBeNull();
    expect(direct.data).toEqual([]);
  });
});

describe("RF-10/RF-09/RF-11 outros endpoints", () => {
  it("cancel-charge: recepção cancela reserva local; profissional => 403; force de recepção => 403", async () => {
    const fixture = await seedAppointment(tenantA.tenantId, {
      status: "concluido",
      priceCents: 10_000,
    });
    const chargeId = await seedCharge({
      tenantId: tenantA.tenantId,
      appointmentId: fixture.appointmentId,
      amountCents: 3_000,
    });

    const denied = await callFunction("cancel-charge", {
      token: professional.accessToken,
      body: { charge_id: chargeId },
    });
    expect(denied.status).toBe(403);

    const forceDenied = await callFunction("cancel-charge", {
      token: receptionist.accessToken,
      body: { charge_id: chargeId, force: true },
    });
    expect(forceDenied.status).toBe(403);

    const cancelled = await callFunction("cancel-charge", {
      token: receptionist.accessToken,
      body: { charge_id: chargeId },
    });
    expect(cancelled.status).toBe(200);
    expect(cancelled.json).toMatchObject({ cancelled: true, gateway_divergence_risk: false });
    const { data } = await serviceClient()
      .from("charges")
      .select("status")
      .eq("id", chargeId)
      .single();
    expect(data?.status).toBe("cancelado");
  });

  it("confirm-charge-manual: recepção => 403; admin confirma; cancelada => 409 CHARGE_CANCELLED", async () => {
    const fixture = await seedAppointment(tenantA.tenantId, {
      status: "concluido",
      priceCents: 10_000,
    });
    const chargeId = await seedCharge({
      tenantId: tenantA.tenantId,
      appointmentId: fixture.appointmentId,
      amountCents: 3_000,
    });

    const denied = await callFunction("confirm-charge-manual", {
      token: receptionist.accessToken,
      body: { charge_id: chargeId },
    });
    expect(denied.status).toBe(403);

    const confirmed = await callFunction("confirm-charge-manual", {
      token: tenantA.admin.accessToken,
      body: { charge_id: chargeId },
    });
    expect(confirmed.status).toBe(200);
    expect((confirmed.json as Record<string, unknown>).replayed).toBe(false);
    expect(ledgerCount(tenantA.tenantId, fixture.appointmentId)).toBe(1);

    const cancelledFixture = await seedAppointment(tenantA.tenantId, {
      status: "concluido",
      priceCents: 10_000,
    });
    const cancelledCharge = await seedCharge({
      tenantId: tenantA.tenantId,
      appointmentId: cancelledFixture.appointmentId,
      amountCents: 3_000,
      status: "cancelado",
    });
    const cancelled = await callFunction("confirm-charge-manual", {
      token: tenantA.admin.accessToken,
      body: { charge_id: cancelledCharge },
    });
    expect(cancelled.status).toBe(409);
    expect(cancelled.json?.code).toBe("CHARGE_CANCELLED");
    expect(ledgerCount(tenantA.tenantId, cancelledFixture.appointmentId)).toBe(0);
  });

  it("void: recepção => 403; admin estorna; motivo só espaços => 400", async () => {
    const fixture = await seedAppointment(tenantA.tenantId, {
      status: "concluido",
      priceCents: 10_000,
    });
    const paymentId = await seedPayment({
      tenantId: tenantA.tenantId,
      appointmentId: fixture.appointmentId,
      amountCents: 2_000,
    });

    const denied = await callFunction("void-appointment-payment", {
      token: receptionist.accessToken,
      body: { payment_id: paymentId, reason: "motivo" },
    });
    expect(denied.status).toBe(403);

    const blank = await callFunction("void-appointment-payment", {
      token: tenantA.admin.accessToken,
      body: { payment_id: paymentId, reason: "   " },
    });
    expect(blank.status).toBe(400);
    expect(blank.json?.code).toBe("INVALID_BODY");

    const voided = await callFunction("void-appointment-payment", {
      token: tenantA.admin.accessToken,
      body: { payment_id: paymentId, reason: "ajuste de caixa" },
    });
    expect(voided.status).toBe(200);
    expect(voided.json).toMatchObject({ refund_required: false });
  });
});

describe("RF-12/I-PII auditoria sem PII", () => {
  it("metadata do audit_log só usa chaves da whitelist", async () => {
    const fixture = await seedAppointment(tenantA.tenantId, {
      status: "em_atendimento",
      priceCents: 10_000,
    });
    await callFunction("register-appointment-payments", {
      token: tenantA.admin.accessToken,
      body: {
        appointment_id: fixture.appointmentId,
        idempotency_key: randomUUID(),
        close_appointment: true,
        payments: [{ method: "dinheiro", amount_cents: 10_000 }],
      },
    });

    const keys = sql(
      `select distinct jsonb_object_keys(metadata)
         from public.audit_log
        where tenant_id = :'tenant'::uuid;`,
      { tenant: tenantA.tenantId },
    )
      .split("\n")
      .filter(Boolean)
      .sort();

    const forbidden = ["name", "customer_name", "phone", "document", "cpf", "pix_qr_code",
      "pix_copy_paste", "payload", "token"];
    for (const key of keys) expect(forbidden).not.toContain(key);
    for (const key of keys) {
      expect([
        "actor_id", "amount_cents", "appointment_id", "charge_id", "code", "event_id",
        "expires_at", "force", "gateway_cancelled", "idempotency_key", "method",
        "payment_id", "reason", "reason_length", "reopened", "source", "tip_cents",
      ]).toContain(key);
    }
  });
});

describe("FIX-4 settlement com cobrança stale", () => {
  it("stale expirado/cancelado: reserved não conta, can_cancel_charge e can_reissue_pix", async () => {
    const expiredFixture = await seedAppointment(tenantA.tenantId, {
      status: "concluido",
      priceCents: 10_000,
    });
    const expiredCharge = await seedCharge({
      tenantId: tenantA.tenantId,
      appointmentId: expiredFixture.appointmentId,
      amountCents: 3_000,
      status: "expirado",
      expiresAt: new Date(Date.now() - 60_000).toISOString(),
    });

    const expiredResponse = await callFunction("get-appointment-settlement", {
      token: tenantA.admin.accessToken,
      body: { appointment_id: expiredFixture.appointmentId },
    });
    expect(expiredResponse.status).toBe(200);
    const expiredBody = expiredResponse.json as Record<string, any>;
    expect(expiredBody.reserved_cents).toBe(0);
    expect(expiredBody.payment_status).toBe("sem_pagamento");
    expect(expiredBody.pending_charges).toHaveLength(0);
    expect(expiredBody.stale_charges).toEqual([
      expect.objectContaining({ id: expiredCharge, status: "expirado", amount_cents: 3_000 }),
    ]);
    expect(expiredBody.permissions.can_cancel_charge).toBe(true);
    expect(expiredBody.permissions.can_reissue_pix).toBe(true);

    const paidFixture = await seedAppointment(tenantA.tenantId, {
      status: "concluido",
      priceCents: 10_000,
    });
    const paidCharge = await seedCharge({
      tenantId: tenantA.tenantId,
      appointmentId: paidFixture.appointmentId,
      amountCents: 3_000,
      status: "pago",
      asaasPaymentId: "pay-paid",
    });
    await seedPayment({
      tenantId: tenantA.tenantId,
      appointmentId: paidFixture.appointmentId,
      method: "pix_sistema",
      amountCents: 3_000,
      chargeId: paidCharge,
      source: "asaas",
    });
    const paidResponse = await callFunction("get-appointment-settlement", {
      token: tenantA.admin.accessToken,
      body: { appointment_id: paidFixture.appointmentId },
    });
    expect(paidResponse.status).toBe(200);
    const paidBody = paidResponse.json as Record<string, any>;
    expect(paidBody.stale_charges).toHaveLength(0);
    expect(paidBody.permissions.can_reissue_pix).toBe(false);
  });
});
