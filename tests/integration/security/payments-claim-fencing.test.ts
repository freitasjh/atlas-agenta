// Claim de criação no gateway e fencing (C1/I1 do re-review ADR-002).
// O token do claim é `charges.gateway_claimed_at`; o attach só grava enquanto
// `gateway_claim_expires_at > now()`. Reserva/reabertura nunca mexem em claim vivo.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { serviceClient } from "../helpers/clients.ts";
import {
  cleanupPaymentFixtures,
  createPaymentsTenant,
  seedAppointment,
  seedCharge,
  type PaymentsTenant,
} from "../helpers/payments-fixtures.ts";
import { sql } from "../helpers/sql.ts";
import { createTenantMember, deleteTestUsers, type TestUser } from "../helpers/users.ts";

let tenant: PaymentsTenant;
let professional: TestUser;
let otherProfessional: TestUser;

interface ChargeRow {
  status: string;
  asaas_payment_id: string | null;
  pix_qr_code: string | null;
  gateway_claimed_at: string | null;
  gateway_claim_expires_at: string | null;
}

function chargeRow(chargeId: string): ChargeRow {
  return JSON.parse(
    sql(
      `select json_build_object(
          'status', status,
          'asaas_payment_id', asaas_payment_id,
          'pix_qr_code', pix_qr_code,
          'gateway_claimed_at', gateway_claimed_at,
          'gateway_claim_expires_at', gateway_claim_expires_at
        )
         from public.charges
        where tenant_id = :'tenant'::uuid and id = :'charge'::uuid;`,
      { tenant: tenant.tenantId, charge: chargeId },
    ),
  ) as ChargeRow;
}

function claim(chargeId: string) {
  return serviceClient().rpc("claim_charge_gateway", {
    p_tenant_id: tenant.tenantId,
    p_charge_id: chargeId,
    p_ttl_seconds: 180,
  });
}

function attach(chargeId: string, claimToken: string, paymentId = "pay-attach") {
  return serviceClient().rpc("attach_charge_gateway_data", {
    p_tenant_id: tenant.tenantId,
    p_charge_id: chargeId,
    p_claim_token: claimToken,
    p_asaas_payment_id: paymentId,
    p_pix_qr_code: "qr",
    p_pix_copy_paste: "copy",
    p_expires_at: new Date(Date.now() + 3_600_000).toISOString(),
  });
}

function reserve(appointmentId: string, actorId: string, amountCents: number) {
  return serviceClient().rpc("reserve_appointment_charge", {
    p_tenant_id: tenant.tenantId,
    p_actor_id: actorId,
    p_appointment_id: appointmentId,
    p_amount_cents: amountCents,
    p_idempotency_key: randomUUID(),
  });
}

function reopen(chargeId: string) {
  return serviceClient().rpc("reopen_charge_for_reissue", {
    p_tenant_id: tenant.tenantId,
    p_charge_id: chargeId,
    p_expires_at: null,
  });
}

function release(chargeId: string, actorId: string, claimToken: string | null = null) {
  return serviceClient().rpc("release_charge_reservation", {
    p_tenant_id: tenant.tenantId,
    p_charge_id: chargeId,
    p_actor_id: actorId,
    p_claim_token: claimToken,
  });
}

beforeAll(async () => {
  tenant = await createPaymentsTenant("payments-claim-fencing");
  professional = await createTenantMember(tenant.tenantId, "professional", "payments-claim-prof");
  otherProfessional = await createTenantMember(
    tenant.tenantId,
    "professional",
    "payments-claim-prof-2",
  );
});

afterAll(async () => {
  await cleanupPaymentFixtures([tenant.tenantId]);
  await deleteTestUsers();
});

describe("C1 fencing do attach", () => {
  it("token correto libera o claim, grava gateway e atualiza expires_at", async () => {
    const fixture = await seedAppointment(tenant.tenantId, {
      status: "concluido",
      priceCents: 10_000,
    });
    const chargeId = await seedCharge({
      tenantId: tenant.tenantId,
      appointmentId: fixture.appointmentId,
      amountCents: 3_000,
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    });

    const claimed = await claim(chargeId);
    expect(claimed.error).toBeNull();
    const token = (claimed.data as { claim_token: string }).claim_token;
    expect(typeof token).toBe("string");

    const attached = await attach(chargeId, token);
    expect(attached.error).toBeNull();

    const row = chargeRow(chargeId);
    expect(row).toMatchObject({
      status: "pendente",
      asaas_payment_id: "pay-attach",
      pix_qr_code: "qr",
      gateway_claimed_at: null,
      gateway_claim_expires_at: null,
    });
  });

  it("token errado => PT409 GATEWAY_CLAIM_LOST e nada é sobrescrito", async () => {
    const fixture = await seedAppointment(tenant.tenantId, {
      status: "concluido",
      priceCents: 10_000,
    });
    const chargeId = await seedCharge({
      tenantId: tenant.tenantId,
      appointmentId: fixture.appointmentId,
      amountCents: 3_000,
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    });

    const claimed = await claim(chargeId);
    const token = (claimed.data as { claim_token: string }).claim_token;
    const wrongToken = new Date(Date.now() + 5_000).toISOString();

    const attached = await attach(chargeId, wrongToken, "pay-wrong");
    expect(attached.error?.code).toBe("PT409");
    expect(attached.error?.message).toBe("GATEWAY_CLAIM_LOST");

    const row = chargeRow(chargeId);
    expect(row).toMatchObject({
      status: "pendente",
      asaas_payment_id: null,
      pix_qr_code: null,
      gateway_claimed_at: token,
    });
  });

  it("cancel_charge libera o claim", async () => {
    const fixture = await seedAppointment(tenant.tenantId, {
      status: "concluido",
      priceCents: 10_000,
    });
    const chargeId = await seedCharge({
      tenantId: tenant.tenantId,
      appointmentId: fixture.appointmentId,
      amountCents: 3_000,
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    });
    expect((await claim(chargeId)).error).toBeNull();

    const cancelled = await serviceClient().rpc("cancel_charge", {
      p_tenant_id: tenant.tenantId,
      p_charge_id: chargeId,
      p_actor_id: tenant.admin.id,
      p_force: false,
      p_gateway_cancelled: true,
    });
    expect(cancelled.error).toBeNull();

    const row = chargeRow(chargeId);
    expect(row.status).toBe("cancelado");
    expect(row.gateway_claimed_at).toBeNull();
    expect(row.gateway_claim_expires_at).toBeNull();
  });

  it("TTL vencido permite novo claim", async () => {
    const fixture = await seedAppointment(tenant.tenantId, {
      status: "concluido",
      priceCents: 10_000,
    });
    const oldToken = new Date(Date.now() - 120_000).toISOString();
    const chargeId = await seedCharge({
      tenantId: tenant.tenantId,
      appointmentId: fixture.appointmentId,
      amountCents: 3_000,
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      gatewayClaimedAt: oldToken,
      gatewayClaimExpiresAt: new Date(Date.now() - 60_000).toISOString(),
    });

    const claimed = await claim(chargeId);
    expect(claimed.error).toBeNull();
    const payload = claimed.data as { claimed: boolean; claim_token: string };
    expect(payload.claimed).toBe(true);
    expect(payload.claim_token).not.toBe(oldToken);

    const row = chargeRow(chargeId);
    expect(row.gateway_claimed_at).toBe(payload.claim_token);
  });
});

describe("C1 guardas de reserva/reabertura", () => {
  it("reserve com claim vivo => PT409 GATEWAY_IN_PROGRESS e estado intacto", async () => {
    const fixture = await seedAppointment(tenant.tenantId, {
      status: "concluido",
      priceCents: 10_000,
    });
    const token = new Date(Date.now() + 30_000).toISOString();
    const chargeId = await seedCharge({
      tenantId: tenant.tenantId,
      appointmentId: fixture.appointmentId,
      amountCents: 3_000,
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      gatewayClaimedAt: token,
      gatewayClaimExpiresAt: new Date(Date.now() + 60_000).toISOString(),
    });

    const result = await reserve(fixture.appointmentId, tenant.admin.id, 3_000);
    expect(result.error?.code).toBe("PT409");
    expect(result.error?.message).toBe("GATEWAY_IN_PROGRESS");

    const row = chargeRow(chargeId);
    expect(row.status).toBe("pendente");
    expect(Date.parse(row.gateway_claimed_at ?? "")).toBe(Date.parse(token));
  });

  it("reopen com claim vivo => PT409 GATEWAY_IN_PROGRESS e estado intacto", async () => {
    const fixture = await seedAppointment(tenant.tenantId, {
      status: "concluido",
      priceCents: 10_000,
    });
    const token = new Date(Date.now() + 30_000).toISOString();
    const chargeId = await seedCharge({
      tenantId: tenant.tenantId,
      appointmentId: fixture.appointmentId,
      amountCents: 3_000,
      status: "expirado",
      asaasPaymentId: "pay-old",
      expiresAt: new Date(Date.now() - 3_600_000).toISOString(),
      gatewayClaimedAt: token,
      gatewayClaimExpiresAt: new Date(Date.now() + 60_000).toISOString(),
    });

    const result = await reopen(chargeId);
    expect(result.error?.code).toBe("PT409");
    expect(result.error?.message).toBe("GATEWAY_IN_PROGRESS");

    const row = chargeRow(chargeId);
    expect(row).toMatchObject({
      status: "expirado",
      asaas_payment_id: "pay-old",
    });
    expect(Date.parse(row.gateway_claimed_at ?? "")).toBe(Date.parse(token));
  });
});

describe("I1 liberação da reserva", () => {
  it("profissional DONO libera a reserva com o token do próprio claim e audita", async () => {
    const fixture = await seedAppointment(tenant.tenantId, {
      status: "concluido",
      priceCents: 10_000,
      professionalProfileId: professional.id,
    });
    const token = new Date(Date.now() + 30_000).toISOString();
    const chargeId = await seedCharge({
      tenantId: tenant.tenantId,
      appointmentId: fixture.appointmentId,
      amountCents: 3_000,
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      gatewayClaimedAt: token,
      gatewayClaimExpiresAt: new Date(Date.now() + 60_000).toISOString(),
    });

    const released = await release(chargeId, professional.id, token);
    expect(released.error).toBeNull();
    expect(released.data).toMatchObject({ released: true, charge_status: "cancelado" });

    const row = chargeRow(chargeId);
    expect(row.status).toBe("cancelado");
    expect(row.gateway_claimed_at).toBeNull();

    expect(
      Number(
        sql(
          `select count(*) from public.audit_log
            where tenant_id = :'tenant'::uuid
              and action = 'charge_reservation_released'
              and target_id = :'charge'::uuid;`,
          { tenant: tenant.tenantId, charge: chargeId },
        ),
      ),
    ).toBe(1);
  });

  it("release com claim vivo de OUTRO criador => PT409 GATEWAY_IN_PROGRESS e estado intacto", async () => {
    const fixture = await seedAppointment(tenant.tenantId, {
      status: "concluido",
      priceCents: 10_000,
    });
    const otherToken = new Date(Date.now() + 30_000).toISOString();
    const chargeId = await seedCharge({
      tenantId: tenant.tenantId,
      appointmentId: fixture.appointmentId,
      amountCents: 3_000,
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      gatewayClaimedAt: otherToken,
      gatewayClaimExpiresAt: new Date(Date.now() + 60_000).toISOString(),
    });

    // Sem token (caller não é o dono do claim) não libera.
    const withoutToken = await release(chargeId, tenant.admin.id);
    expect(withoutToken.error?.code).toBe("PT409");
    expect(withoutToken.error?.message).toBe("GATEWAY_IN_PROGRESS");

    // Token de outro criador também não libera.
    const wrongToken = await release(
      chargeId,
      tenant.admin.id,
      new Date(Date.now() + 5_000).toISOString(),
    );
    expect(wrongToken.error?.code).toBe("PT409");
    expect(wrongToken.error?.message).toBe("GATEWAY_IN_PROGRESS");

    const row = chargeRow(chargeId);
    expect(row.status).toBe("pendente");
    expect(Date.parse(row.gateway_claimed_at ?? "")).toBe(Date.parse(otherToken));
  });

  it("release com claim vencido libera mesmo sem token", async () => {
    const fixture = await seedAppointment(tenant.tenantId, {
      status: "concluido",
      priceCents: 10_000,
    });
    const chargeId = await seedCharge({
      tenantId: tenant.tenantId,
      appointmentId: fixture.appointmentId,
      amountCents: 3_000,
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      gatewayClaimedAt: new Date(Date.now() - 120_000).toISOString(),
      gatewayClaimExpiresAt: new Date(Date.now() - 60_000).toISOString(),
    });

    const released = await release(chargeId, tenant.admin.id);
    expect(released.error).toBeNull();
    expect(released.data).toMatchObject({ released: true, charge_status: "cancelado" });
    expect(chargeRow(chargeId).gateway_claimed_at).toBeNull();
  });

  it("profissional ALHEIO recebe PT403 e nada muda", async () => {
    const fixture = await seedAppointment(tenant.tenantId, {
      status: "concluido",
      priceCents: 10_000,
      professionalProfileId: professional.id,
    });
    const chargeId = await seedCharge({
      tenantId: tenant.tenantId,
      appointmentId: fixture.appointmentId,
      amountCents: 3_000,
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    });

    const denied = await release(chargeId, otherProfessional.id);
    expect(denied.error?.code).toBe("PT403");
    expect(denied.error?.message).toBe("PROFESSIONAL_NOT_OWNER");
    expect(chargeRow(chargeId).status).toBe("pendente");
  });

  it("cobrança paga nunca é liberada", async () => {
    const fixture = await seedAppointment(tenant.tenantId, {
      status: "concluido",
      priceCents: 10_000,
    });
    const chargeId = await seedCharge({
      tenantId: tenant.tenantId,
      appointmentId: fixture.appointmentId,
      amountCents: 3_000,
      status: "pago",
      asaasPaymentId: "pay-paid",
    });

    const released = await release(chargeId, tenant.admin.id);
    expect(released.error).toBeNull();
    expect(released.data).toMatchObject({ released: false, charge_status: "pago" });
    expect(chargeRow(chargeId).status).toBe("pago");
  });
});
