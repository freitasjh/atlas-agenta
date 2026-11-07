// Concorrência e saldo (ADR-002; RF-04, RF-14). O lock do atendimento é o mesmo em
// register e reserve; a soma paga + reservada nunca passa do preço.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { serviceClient } from "../helpers/clients.ts";
import {
  cleanupPaymentFixtures,
  createPaymentsTenant,
  readSummary,
  seedAppointment,
  seedCharge,
  seedPayment,
  type PaymentsTenant,
} from "../helpers/payments-fixtures.ts";
import { sql } from "../helpers/sql.ts";
import { deleteTestUsers } from "../helpers/users.ts";

let tenant: PaymentsTenant;

function register(
  appointmentId: string,
  amountCents: number,
  key: string,
  close = false,
) {
  return serviceClient().rpc("register_appointment_payments", {
    p_tenant_id: tenant.tenantId,
    p_actor_id: tenant.admin.id,
    p_appointment_id: appointmentId,
    p_payments: [{ method: "dinheiro", amount_cents: amountCents }],
    p_idempotency_key: key,
    p_close_appointment: close,
  });
}

function reserve(appointmentId: string, amountCents: number | null, key: string | null) {
  return serviceClient().rpc("reserve_appointment_charge", {
    p_tenant_id: tenant.tenantId,
    p_actor_id: tenant.admin.id,
    p_appointment_id: appointmentId,
    p_amount_cents: amountCents,
    p_idempotency_key: key,
  });
}

function claim(chargeId: string) {
  return serviceClient().rpc("claim_charge_gateway", {
    p_tenant_id: tenant.tenantId,
    p_charge_id: chargeId,
    p_ttl_seconds: 180,
  });
}

async function chargeCount(appointmentId: string): Promise<number> {
  const { count, error } = await serviceClient()
    .from("charges")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenant.tenantId)
    .eq("appointment_id", appointmentId);
  if (error) throw new Error("Contagem de charges falhou.");
  return count ?? 0;
}

beforeAll(async () => {
  tenant = await createPaymentsTenant("payments-concurrency");
});

afterAll(async () => {
  await cleanupPaymentFixtures([tenant.tenantId]);
  await deleteTestUsers();
});

describe("RF-04 register x register", () => {
  it("duas chamadas de 1000 com saldo 1000: exatamente uma passa (10 execuções)", async () => {
    for (let round = 0; round < 10; round += 1) {
      const fixture = await seedAppointment(tenant.tenantId, {
        status: "concluido",
        priceCents: 10_000,
      });
      await seedPayment({
        tenantId: tenant.tenantId,
        appointmentId: fixture.appointmentId,
        amountCents: 9_000,
      });

      const [first, second] = await Promise.all([
        register(fixture.appointmentId, 1_000, randomUUID()),
        register(fixture.appointmentId, 1_000, randomUUID()),
      ]);

      const failures = [first, second].filter((result) => result.error !== null);
      const successes = [first, second].filter((result) => result.error === null);
      expect(successes.length, `rodada ${round}`).toBe(1);
      expect(failures.length, `rodada ${round}`).toBe(1);
      expect(failures[0]?.error?.code).toBe("PT409");
      expect(failures[0]?.error?.message).toBe("AMOUNT_EXCEEDS_REMAINING");

      const summary = await readSummary(tenant.tenantId, fixture.appointmentId);
      expect(Number(summary?.total_paid_cents)).toBeLessThanOrEqual(10_000);
      expect(Number(summary?.total_paid_cents)).toBe(10_000);
    }
  });
});

describe("RF-04 register x reserve", () => {
  it("saldo 4000: register(4000) e reserve(3000) em paralelo nunca estouram o preço", async () => {
    const fixture = await seedAppointment(tenant.tenantId, {
      status: "concluido",
      priceCents: 10_000,
    });
    await seedPayment({
      tenantId: tenant.tenantId,
      appointmentId: fixture.appointmentId,
      amountCents: 6_000,
    });

    const [registered, reserved] = await Promise.all([
      register(fixture.appointmentId, 4_000, randomUUID()),
      reserve(fixture.appointmentId, 3_000, randomUUID()),
    ]);

    // Nenhuma das chamadas pode terminar em 5xx; no máximo uma consome o saldo.
    for (const result of [registered, reserved]) {
      if (result.error) expect(result.error.code).toBe("PT409");
    }
    const successes = [registered, reserved].filter((result) => result.error === null);
    expect(successes.length).toBe(1);

    const summary = await readSummary(tenant.tenantId, fixture.appointmentId);
    const paid = Number(summary?.total_paid_cents ?? 0);
    const held = Number(summary?.reserved_cents ?? 0);
    expect(paid + held).toBeLessThanOrEqual(10_000);
  });
});

describe("RF-04 reserve x reserve", () => {
  it("mesma chave em paralelo cria 1 cobrança e a segunda é reuso", async () => {
    const fixture = await seedAppointment(tenant.tenantId, {
      status: "concluido",
      priceCents: 10_000,
    });
    const key = randomUUID();

    const [first, second] = await Promise.all([
      reserve(fixture.appointmentId, 3_000, key),
      reserve(fixture.appointmentId, 3_000, key),
    ]);

    expect(first.error).toBeNull();
    expect(second.error).toBeNull();
    expect(
      (first.data as Record<string, unknown>).charge_id,
    ).toBe((second.data as Record<string, unknown>).charge_id);
    expect(
      [first.data, second.data].some(
        (data) => (data as Record<string, unknown>).reused === true,
      ),
    ).toBe(true);
    expect(await chargeCount(fixture.appointmentId)).toBe(1);
  });

  it("chaves diferentes em paralelo continuam com 1 cobrança (reuso)", async () => {
    const fixture = await seedAppointment(tenant.tenantId, {
      status: "concluido",
      priceCents: 10_000,
    });

    const [first, second] = await Promise.all([
      reserve(fixture.appointmentId, 3_000, randomUUID()),
      reserve(fixture.appointmentId, 3_000, randomUUID()),
    ]);

    expect(first.error).toBeNull();
    expect(second.error).toBeNull();
    expect(await chargeCount(fixture.appointmentId)).toBe(1);
  });
});

describe("FIX claim de criação no gateway (1 POST /payments)", () => {
  it("duas claims concorrentes: exatamente uma pega o claim", async () => {
    const fixture = await seedAppointment(tenant.tenantId, {
      status: "concluido",
      priceCents: 10_000,
    });
    const chargeId = await seedCharge({
      tenantId: tenant.tenantId,
      appointmentId: fixture.appointmentId,
      amountCents: 3_000,
      status: "pendente",
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    });

    const [first, second] = await Promise.all([claim(chargeId), claim(chargeId)]);
    expect(first.error).toBeNull();
    expect(second.error).toBeNull();

    const claimed = [first.data, second.data].filter(
      (data) => (data as { claimed?: boolean }).claimed === true,
    );
    expect(claimed).toHaveLength(1);
    const rejected = [first.data, second.data].find(
      (data) => (data as { claimed?: boolean }).claimed === false,
    );
    expect((rejected as { charge: Record<string, unknown> }).charge).toMatchObject({
      charge_id: chargeId,
      status: "pendente",
      asaas_payment_id: null,
    });

    expect(
      Number(
        sql(
          `select count(*) from public.audit_log
            where tenant_id = :'tenant'::uuid and action = 'charge_gateway_claimed'
              and target_id = :'charge'::uuid;`,
          { tenant: tenant.tenantId, charge: chargeId },
        ),
      ),
    ).toBe(1);
  });

  it("claim não pega cobrança paga nem cobrança com gateway já anexado", async () => {
    const paidFixture = await seedAppointment(tenant.tenantId, {
      status: "concluido",
      priceCents: 10_000,
    });
    const paidCharge = await seedCharge({
      tenantId: tenant.tenantId,
      appointmentId: paidFixture.appointmentId,
      amountCents: 3_000,
      status: "pago",
      asaasPaymentId: "pay-paid",
    });
    const denied = await claim(paidCharge);
    expect(denied.error).toBeNull();
    expect(denied.data).toMatchObject({ claimed: false });

    const attachedFixture = await seedAppointment(tenant.tenantId, {
      status: "concluido",
      priceCents: 10_000,
    });
    const attached = await seedCharge({
      tenantId: tenant.tenantId,
      appointmentId: attachedFixture.appointmentId,
      amountCents: 3_000,
      status: "pendente",
      asaasPaymentId: "pay-attached",
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    });
    expect((await claim(attached)).data).toMatchObject({ claimed: false });
  });
});
