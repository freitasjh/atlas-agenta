// settle / cancel / void (ADR-002; RF-09, RF-10, RF-11).
// Nenhum caminho rebaixa `charges.status='pago'` nem apaga linha do ledger.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { serviceClient } from "../helpers/clients.ts";
import {
  cleanupPaymentFixtures,
  createPaymentsTenant,
  seedAppointment,
  seedCharge,
  seedPayment,
  type AppointmentFixture,
  type PaymentsTenant,
} from "../helpers/payments-fixtures.ts";
import { sql } from "../helpers/sql.ts";
import { createTenantMember, deleteTestUsers, type TestUser } from "../helpers/users.ts";

let tenantA: PaymentsTenant;
let tenantB: PaymentsTenant;
let receptionist: TestUser;
let professional: TestUser;

function settle(
  tenantId: string,
  chargeId: string,
  options: { paidAt?: string | null; source?: "asaas" | "manual"; actorId?: string | null; eventId?: string | null } = {},
) {
  return serviceClient().rpc("settle_charge_payment", {
    p_tenant_id: tenantId,
    p_charge_id: chargeId,
    p_paid_at: options.paidAt ?? null,
    p_source: options.source ?? "asaas",
    p_actor_id: options.actorId ?? null,
    p_event_id: options.eventId ?? null,
  });
}

function cancel(
  tenantId: string,
  chargeId: string,
  actorId: string,
  force = false,
  gatewayCancelled = false,
) {
  return serviceClient().rpc("cancel_charge", {
    p_tenant_id: tenantId,
    p_charge_id: chargeId,
    p_actor_id: actorId,
    p_force: force,
    p_gateway_cancelled: gatewayCancelled,
  });
}

function voidPayment(tenantId: string, paymentId: string, actorId: string, reason: string) {
  return serviceClient().rpc("void_appointment_payment", {
    p_tenant_id: tenantId,
    p_payment_id: paymentId,
    p_actor_id: actorId,
    p_reason: reason,
  });
}

function reserveCharge(
  tenantId: string,
  actorId: string,
  appointmentId: string,
  amountCents: number | null,
  key: string | null,
) {
  return serviceClient().rpc("reserve_appointment_charge", {
    p_tenant_id: tenantId,
    p_actor_id: actorId,
    p_appointment_id: appointmentId,
    p_amount_cents: amountCents,
    p_idempotency_key: key,
  });
}

function reopenCharge(tenantId: string, chargeId: string) {
  return serviceClient().rpc("reopen_charge_for_reissue", {
    p_tenant_id: tenantId,
    p_charge_id: chargeId,
    p_expires_at: null,
  });
}

async function chargeStatus(chargeId: string): Promise<string | null> {
  const { data, error } = await serviceClient()
    .from("charges")
    .select("status")
    .eq("id", chargeId)
    .maybeSingle();
  if (error) throw new Error("Leitura de charge falhou.");
  return (data?.status as string | undefined) ?? null;
}

async function paymentRows(appointmentId: string): Promise<Array<Record<string, unknown>>> {
  const { data, error } = await serviceClient()
    .from("appointment_payments")
    .select("id, method, amount_cents, source, received_by, voided_at, void_reason")
    .eq("appointment_id", appointmentId);
  if (error) throw new Error("Leitura do ledger falhou.");
  return (data ?? []) as Array<Record<string, unknown>>;
}

async function pendingFixture(priceCents = 10_000, amountCents = 3_000): Promise<{
  fixture: AppointmentFixture;
  chargeId: string;
}> {
  const fixture = await seedAppointment(tenantA.tenantId, { priceCents });
  const chargeId = await seedCharge({
    tenantId: tenantA.tenantId,
    appointmentId: fixture.appointmentId,
    amountCents,
    status: "pendente",
  });
  return { fixture, chargeId };
}

beforeAll(async () => {
  tenantA = await createPaymentsTenant("payments-settle-a");
  tenantB = await createPaymentsTenant("payments-settle-b");
  receptionist = await createTenantMember(tenantA.tenantId, "receptionist", "payments-settle-recep");
  professional = await createTenantMember(tenantA.tenantId, "professional", "payments-settle-prof");
});

afterAll(async () => {
  await cleanupPaymentFixtures([tenantA.tenantId, tenantB.tenantId]);
  await deleteTestUsers();
});

describe("RF-09 settle_charge_payment", () => {
  it("pendente 3000 => 1 linha pix_sistema/asaas, charge pago, paid_at e auditoria", async () => {
    const { fixture, chargeId } = await pendingFixture();
    const paidAt = new Date(Date.now() - 60_000).toISOString();

    const { data, error } = await settle(tenantA.tenantId, chargeId, {
      paidAt,
      eventId: "evt-1",
    });

    expect(error).toBeNull();
    expect(data).toMatchObject({
      ok: true,
      charge_status: "pago",
      replayed: false,
      anomaly: null,
    });
    expect((data as { payment: Record<string, unknown> }).payment).toMatchObject({
      method: "pix_sistema",
      amount_cents: 3_000,
      source: "asaas",
      charge_id: chargeId,
    });

    const charges = await serviceClient()
      .from("charges")
      .select("status, paid_at")
      .eq("id", chargeId)
      .single();
    expect(charges.data?.status).toBe("pago");
    expect(charges.data?.paid_at).toBeTruthy();

    const rows = await paymentRows(fixture.appointmentId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ method: "pix_sistema", amount_cents: 3_000, source: "asaas" });
    expect(
      Number(
        sql(
          `select count(*) from public.audit_log
            where tenant_id = :'tenant'::uuid and action = 'charge_paid'
              and target_id = :'charge'::uuid;`,
          { tenant: tenantA.tenantId, charge: chargeId },
        ),
      ),
    ).toBe(1);
  });

  it("baixa manual: admin passa, recepção recebe FORBIDDEN; received_by é o admin", async () => {
    const { fixture, chargeId } = await pendingFixture();
    const denied = await settle(tenantA.tenantId, chargeId, {
      source: "manual",
      actorId: receptionist.id,
    });
    expect(denied.error?.code).toBe("PT403");
    expect(denied.error?.message).toBe("FORBIDDEN");

    const { data, error } = await settle(tenantA.tenantId, chargeId, {
      source: "manual",
      actorId: tenantA.admin.id,
    });
    expect(error).toBeNull();
    expect((data as { payment: Record<string, unknown> }).payment).toMatchObject({
      source: "manual",
      amount_cents: 3_000,
    });
    const rows = await paymentRows(fixture.appointmentId);
    expect(rows[0]?.received_by).toBe(tenantA.admin.id);
  });

  it("cobrança de assinatura => CHARGE_NOT_APPOINTMENT; inexistente => CHARGE_NOT_FOUND", async () => {
    const subscriptionCharge = await seedCharge({
      tenantId: tenantA.tenantId,
      appointmentId: null,
      status: "pendente",
    });
    const notAppointment = await settle(tenantA.tenantId, subscriptionCharge);
    expect(notAppointment.error?.code).toBe("PT409");
    expect(notAppointment.error?.message).toBe("CHARGE_NOT_APPOINTMENT");

    const missing = await settle(tenantA.tenantId, randomUUID());
    expect(missing.error?.code).toBe("PT404");
    expect(missing.error?.message).toBe("CHARGE_NOT_FOUND");
  });

  it("cancelada => anomalia charge_paid_after_cancel sem linha e sem rebaixar status", async () => {
    const { fixture, chargeId } = await pendingFixture();
    await serviceClient().from("charges").update({ status: "cancelado" }).eq("id", chargeId);

    const { data, error } = await settle(tenantA.tenantId, chargeId);
    expect(error).toBeNull();
    expect(data).toMatchObject({
      ok: true,
      payment: null,
      anomaly: "charge_paid_after_cancel",
      charge_status: "cancelado",
    });
    expect(await paymentRows(fixture.appointmentId)).toHaveLength(0);
    expect(await chargeStatus(chargeId)).toBe("cancelado");
    expect(
      Number(
        sql(
          `select count(*) from public.audit_log
            where tenant_id = :'tenant'::uuid and action = 'charge_paid_after_cancel'
              and target_id = :'charge'::uuid;`,
          { tenant: tenantA.tenantId, charge: chargeId },
        ),
      ),
    ).toBe(1);
  });

  it("valor 0 => anomalia charge_invalid_amount sem linha", async () => {
    const fixture = await seedAppointment(tenantA.tenantId, { priceCents: 10_000 });
    const chargeId = await seedCharge({
      tenantId: tenantA.tenantId,
      appointmentId: fixture.appointmentId,
      amountCents: 0,
      status: "pendente",
    });

    const { data, error } = await settle(tenantA.tenantId, chargeId);
    expect(error).toBeNull();
    expect(data).toMatchObject({ payment: null, anomaly: "charge_invalid_amount" });
    expect(await paymentRows(fixture.appointmentId)).toHaveLength(0);
  });

  it("paga com linha => replay; paga sem linha (legado) => cria 1 linha", async () => {
    const withLine = await pendingFixture();
    const first = await settle(tenantA.tenantId, withLine.chargeId);
    expect(first.error).toBeNull();
    const replay = await settle(tenantA.tenantId, withLine.chargeId);
    expect(replay.error).toBeNull();
    expect(replay.data).toMatchObject({ replayed: true, charge_status: "pago" });
    expect(await paymentRows(withLine.fixture.appointmentId)).toHaveLength(1);

    const legacy = await seedAppointment(tenantA.tenantId, { priceCents: 10_000 });
    const legacyCharge = await seedCharge({
      tenantId: tenantA.tenantId,
      appointmentId: legacy.appointmentId,
      amountCents: 3_000,
      status: "pago",
      paidAt: new Date().toISOString(),
    });
    const created = await settle(tenantA.tenantId, legacyCharge);
    expect(created.error).toBeNull();
    expect(created.data).toMatchObject({ replayed: false, charge_status: "pago" });
    expect(await paymentRows(legacy.appointmentId)).toHaveLength(1);
    expect(await chargeStatus(legacyCharge)).toBe("pago");
  });
});

describe("RF-10 cancel_charge", () => {
  it("pendente + gateway_cancelled=true => cancelado, auditoria e replay idempotente", async () => {
    const { chargeId } = await pendingFixture();
    const { data, error } = await cancel(
      tenantA.tenantId,
      chargeId,
      receptionist.id,
      false,
      true,
    );
    expect(error).toBeNull();
    expect(data).toMatchObject({
      cancelled: true,
      replayed: false,
      charge_status: "cancelado",
      gateway_divergence_risk: false,
    });
    expect(await chargeStatus(chargeId)).toBe("cancelado");
    expect(
      Number(
        sql(
          `select count(*) from public.audit_log
            where tenant_id = :'tenant'::uuid and action = 'charge_cancelled'
              and target_id = :'charge'::uuid;`,
          { tenant: tenantA.tenantId, charge: chargeId },
        ),
      ),
    ).toBe(1);

    const replay = await cancel(tenantA.tenantId, chargeId, receptionist.id, false, true);
    expect(replay.error).toBeNull();
    expect(replay.data).toMatchObject({ cancelled: true, replayed: true });
  });

  it("gateway falhou + force=false => PT422 e status inalterado", async () => {
    const { chargeId } = await pendingFixture();
    const { error } = await cancel(tenantA.tenantId, chargeId, receptionist.id, false, false);
    expect(error?.code).toBe("PT422");
    expect(error?.message).toBe("GATEWAY_CANCEL_FAILED");
    expect(await chargeStatus(chargeId)).toBe("pendente");
  });

  it("profissional => FORBIDDEN; pago => CHARGE_NOT_PENDING", async () => {
    const { chargeId } = await pendingFixture();
    const denied = await cancel(tenantA.tenantId, chargeId, professional.id, false, true);
    expect(denied.error?.code).toBe("PT403");
    expect(denied.error?.message).toBe("FORBIDDEN");

    const paidFixture = await pendingFixture();
    await serviceClient()
      .from("charges")
      .update({ status: "pago", paid_at: new Date().toISOString() })
      .eq("id", paidFixture.chargeId);
    const paid = await cancel(tenantA.tenantId, paidFixture.chargeId, tenantA.admin.id, true, true);
    expect(paid.error?.code).toBe("PT409");
    expect(paid.error?.message).toBe("CHARGE_NOT_PENDING");
    expect(await chargeStatus(paidFixture.chargeId)).toBe("pago");
  });

  it("expirado: força de admin cancela e audita risco; sem force continua PT422", async () => {
    const expired = await seedAppointment(tenantA.tenantId, { priceCents: 10_000 });
    const chargeId = await seedCharge({
      tenantId: tenantA.tenantId,
      appointmentId: expired.appointmentId,
      amountCents: 3_000,
      status: "expirado",
    });

    const noForce = await cancel(tenantA.tenantId, chargeId, receptionist.id, false, false);
    expect(noForce.error?.code).toBe("PT422");
    expect(await chargeStatus(chargeId)).toBe("expirado");

    const forced = await cancel(tenantA.tenantId, chargeId, tenantA.admin.id, true, false);
    expect(forced.error).toBeNull();
    expect(forced.data).toMatchObject({
      cancelled: true,
      charge_status: "cancelado",
      gateway_divergence_risk: true,
    });
    expect(await chargeStatus(chargeId)).toBe("cancelado");
    expect(
      Number(
        sql(
          `select count(*) from public.audit_log
            where tenant_id = :'tenant'::uuid and action = 'charge_cancelled_forced'
              and target_id = :'charge'::uuid;`,
          { tenant: tenantA.tenantId, charge: chargeId },
        ),
      ),
    ).toBe(1);
  });

  it("force de recepção => FORBIDDEN", async () => {
    const { chargeId } = await pendingFixture();
    const { error } = await cancel(tenantA.tenantId, chargeId, receptionist.id, true, true);
    expect(error?.code).toBe("PT403");
    expect(error?.message).toBe("FORBIDDEN");
  });
});

describe("RF-11 void_appointment_payment", () => {
  it("estorno com charge mantém a linha, preenche voided_*, sai das somas e exige refund", async () => {
    const fixture = await seedAppointment(tenantA.tenantId, { priceCents: 10_000 });
    const chargeId = await seedCharge({
      tenantId: tenantA.tenantId,
      appointmentId: fixture.appointmentId,
      amountCents: 3_000,
      status: "pago",
    });
    const paymentId = await seedPayment({
      tenantId: tenantA.tenantId,
      appointmentId: fixture.appointmentId,
      method: "pix_sistema",
      amountCents: 3_000,
      chargeId,
      source: "asaas",
    });

    const { data, error } = await voidPayment(
      tenantA.tenantId,
      paymentId,
      tenantA.admin.id,
      "cliente pediu estorno",
    );
    expect(error).toBeNull();
    expect(data).toMatchObject({ voided: true, replayed: false, refund_required: true });
    expect((data as { settlement: Record<string, unknown> }).settlement).toMatchObject({
      total_paid_cents: 0,
      remaining_cents: 10_000,
    });

    const rows = await paymentRows(fixture.appointmentId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.voided_at).toBeTruthy();
    expect(rows[0]?.void_reason).toBe("cliente pediu estorno");
    expect(await chargeStatus(chargeId)).toBe("pago");
  });

  it("linha sem charge => refund_required=false", async () => {
    const fixture = await seedAppointment(tenantA.tenantId, { priceCents: 10_000 });
    const paymentId = await seedPayment({
      tenantId: tenantA.tenantId,
      appointmentId: fixture.appointmentId,
      amountCents: 3_000,
    });
    const { data, error } = await voidPayment(
      tenantA.tenantId,
      paymentId,
      tenantA.admin.id,
      "ajuste",
    );
    expect(error).toBeNull();
    expect(data).toMatchObject({ refund_required: false });
  });

  it("recepção => FORBIDDEN; motivo vazio => INVALID_BODY; outro tenant => PAYMENT_NOT_FOUND", async () => {
    const fixture = await seedAppointment(tenantA.tenantId, { priceCents: 10_000 });
    const paymentId = await seedPayment({
      tenantId: tenantA.tenantId,
      appointmentId: fixture.appointmentId,
      amountCents: 1_000,
    });

    const denied = await voidPayment(tenantA.tenantId, paymentId, receptionist.id, "motivo");
    expect(denied.error?.code).toBe("PT403");

    const empty = await voidPayment(tenantA.tenantId, paymentId, tenantA.admin.id, "   ");
    expect(empty.error?.code).toBe("PT400");
    expect(empty.error?.message).toBe("INVALID_BODY");

    const foreign = await seedAppointment(tenantB.tenantId, { priceCents: 10_000 });
    const foreignPayment = await seedPayment({
      tenantId: tenantB.tenantId,
      appointmentId: foreign.appointmentId,
      amountCents: 1_000,
    });
    const notFound = await voidPayment(tenantA.tenantId, foreignPayment, tenantA.admin.id, "motivo");
    expect(notFound.error?.code).toBe("PT404");
    expect(notFound.error?.message).toBe("PAYMENT_NOT_FOUND");
  });

  it("estorno duplo => replay preservando voided_at original", async () => {
    const fixture = await seedAppointment(tenantA.tenantId, { priceCents: 10_000 });
    const paymentId = await seedPayment({
      tenantId: tenantA.tenantId,
      appointmentId: fixture.appointmentId,
      amountCents: 1_000,
    });

    const first = await voidPayment(tenantA.tenantId, paymentId, tenantA.admin.id, "primeiro");
    expect(first.error).toBeNull();
    const original = sql(
      `select voided_at::text from public.appointment_payments where id = :'payment'::uuid;`,
      { payment: paymentId },
    );

    const second = await voidPayment(tenantA.tenantId, paymentId, tenantA.admin.id, "segundo");
    expect(second.error).toBeNull();
    expect(second.data).toMatchObject({ voided: true, replayed: true });
    const after = sql(
      `select voided_at::text from public.appointment_payments where id = :'payment'::uuid;`,
      { payment: paymentId },
    );
    expect(after).toBe(original);
  });

  it("motivo acima de 500 => INVALID_BODY", async () => {
    const fixture = await seedAppointment(tenantA.tenantId, { priceCents: 10_000 });
    const paymentId = await seedPayment({
      tenantId: tenantA.tenantId,
      appointmentId: fixture.appointmentId,
      amountCents: 1_000,
    });
    const { error } = await voidPayment(
      tenantA.tenantId,
      paymentId,
      tenantA.admin.id,
      "x".repeat(501),
    );
    expect(error?.code).toBe("PT400");
    expect(error?.message).toBe("INVALID_BODY");
  });
});

describe("FIX reemissão de PIX (1 ativo por vez)", () => {
  it("pendente vencida => reissue=true, marca expirado e reapresenta a MESMA linha", async () => {
    const fixture = await seedAppointment(tenantA.tenantId, {
      status: "concluido",
      priceCents: 10_000,
    });
    const chargeId = await seedCharge({
      tenantId: tenantA.tenantId,
      appointmentId: fixture.appointmentId,
      amountCents: 3_000,
      status: "pendente",
      asaasPaymentId: "pay-old",
      idempotencyKey: randomUUID(),
      expiresAt: new Date(Date.now() - 60_000).toISOString(),
    });

    const { data, error } = await reserveCharge(
      tenantA.tenantId,
      tenantA.admin.id,
      fixture.appointmentId,
      3_000,
      randomUUID(),
    );
    expect(error).toBeNull();
    expect(data).toMatchObject({
      reissue: true,
      previous_charge_id: chargeId,
      previous_asaas_payment_id: "pay-old",
      charge_id: chargeId,
      amount_cents: 3_000,
      status: "expirado",
    });
    expect(await chargeStatus(chargeId)).toBe("expirado");
    expect(
      Number(
        sql(
          `select count(*) from public.charges
            where tenant_id = :'tenant'::uuid and appointment_id = :'appointment'::uuid;`,
          { tenant: tenantA.tenantId, appointment: fixture.appointmentId },
        ),
      ),
    ).toBe(1);
  });

  it("cancelada => reissue=true; paga => CHARGE_NOT_PENDING e nunca reemite", async () => {
    const cancelled = await seedAppointment(tenantA.tenantId, {
      status: "concluido",
      priceCents: 10_000,
    });
    const cancelledCharge = await seedCharge({
      tenantId: tenantA.tenantId,
      appointmentId: cancelled.appointmentId,
      amountCents: 3_000,
      status: "cancelado",
      asaasPaymentId: "pay-cancelled",
      expiresAt: new Date(Date.now() - 60_000).toISOString(),
    });
    const reissue = await reserveCharge(
      tenantA.tenantId,
      tenantA.admin.id,
      cancelled.appointmentId,
      3_000,
      randomUUID(),
    );
    expect(reissue.error).toBeNull();
    expect(reissue.data).toMatchObject({
      reissue: true,
      previous_charge_id: cancelledCharge,
      previous_asaas_payment_id: "pay-cancelled",
      status: "cancelado",
    });

    const paid = await seedAppointment(tenantA.tenantId, {
      status: "concluido",
      priceCents: 10_000,
    });
    const paidCharge = await seedCharge({
      tenantId: tenantA.tenantId,
      appointmentId: paid.appointmentId,
      amountCents: 3_000,
      status: "pago",
      asaasPaymentId: "pay-paid",
    });
    const denied = await reserveCharge(
      tenantA.tenantId,
      tenantA.admin.id,
      paid.appointmentId,
      3_000,
      randomUUID(),
    );
    expect(denied.error?.code).toBe("PT409");
    expect(denied.error?.message).toBe("CHARGE_NOT_PENDING");
    expect(await chargeStatus(paidCharge)).toBe("pago");
  });

  it("reopen_charge_for_reissue limpa gateway/idempotência e audita charge_reissued", async () => {
    const fixture = await seedAppointment(tenantA.tenantId, {
      status: "concluido",
      priceCents: 10_000,
    });
    const chargeId = await seedCharge({
      tenantId: tenantA.tenantId,
      appointmentId: fixture.appointmentId,
      amountCents: 3_000,
      status: "cancelado",
      asaasPaymentId: "pay-reopen-old",
      idempotencyKey: randomUUID(),
      pixQrCode: "qr-old",
      pixCopyPaste: "copy-old",
      expiresAt: new Date(Date.now() - 60_000).toISOString(),
    });
    await serviceClient()
      .from("charges")
      .update({
        gateway_claimed_at: new Date(Date.now() - 120_000).toISOString(),
        gateway_claim_expires_at: new Date(Date.now() - 60_000).toISOString(),
      })
      .eq("id", chargeId);

    const { data, error } = await reopenCharge(tenantA.tenantId, chargeId);
    expect(error).toBeNull();
    expect(data).toMatchObject({
      charge_id: chargeId,
      amount_cents: 3_000,
      status: "pendente",
      asaas_payment_id: null,
      pix_qr_code: null,
      pix_copy_paste: null,
    });

    const row = sql(
      `select status || ':' || coalesce(asaas_payment_id, 'null')
              || ':' || coalesce(pix_qr_code, 'null')
              || ':' || coalesce(pix_copy_paste, 'null')
              || ':' || coalesce(idempotency_key::text, 'null')
              || ':' || coalesce(gateway_claimed_at::text, 'null')
              || ':' || coalesce(gateway_claim_expires_at::text, 'null')
         from public.charges where id = :'charge'::uuid;`,
      { charge: chargeId },
    );
    expect(row).toBe("pendente:null:null:null:null:null:null");
    expect(
      Number(
        sql(
          `select count(*) from public.audit_log
            where tenant_id = :'tenant'::uuid and action = 'charge_reissued'
              and target_id = :'charge'::uuid;`,
          { tenant: tenantA.tenantId, charge: chargeId },
        ),
      ),
    ).toBe(1);
  });

  it("reopen em cobrança paga/pendente ativa => CHARGE_NOT_PENDING", async () => {
    const paidFixture = await seedAppointment(tenantA.tenantId, {
      status: "concluido",
      priceCents: 10_000,
    });
    const paidCharge = await seedCharge({
      tenantId: tenantA.tenantId,
      appointmentId: paidFixture.appointmentId,
      amountCents: 3_000,
      status: "pago",
    });
    const paid = await reopenCharge(tenantA.tenantId, paidCharge);
    expect(paid.error?.code).toBe("PT409");
    expect(paid.error?.message).toBe("CHARGE_NOT_PENDING");

    const activeFixture = await seedAppointment(tenantA.tenantId, {
      status: "concluido",
      priceCents: 10_000,
    });
    const activeCharge = await seedCharge({
      tenantId: tenantA.tenantId,
      appointmentId: activeFixture.appointmentId,
      amountCents: 3_000,
      status: "pendente",
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    });
    const active = await reopenCharge(tenantA.tenantId, activeCharge);
    expect(active.error?.code).toBe("PT409");
    expect(active.error?.message).toBe("CHARGE_NOT_PENDING");
    expect(await chargeStatus(paidCharge)).toBe("pago");
    expect(await chargeStatus(activeCharge)).toBe("pendente");
  });
});
