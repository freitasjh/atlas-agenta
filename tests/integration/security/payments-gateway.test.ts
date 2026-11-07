// Falha de gateway determinística (ADR-002; RF-03, RF-14).
// A suíte aponta ASAAS_API_BASE_URL para 127.0.0.1:1 (porta fechada): nenhum host externo.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { serviceClient } from "../helpers/clients.ts";
import { callFunction } from "../helpers/functions.ts";
import {
  cleanupPaymentFixtures,
  createPaymentsTenant,
  encryptAsaasKey,
  seedAppointment,
  seedAsaasConfig,
  seedCharge,
  seedPayment,
  type PaymentsTenant,
} from "../helpers/payments-fixtures.ts";
import { sql } from "../helpers/sql.ts";
import { deleteTestUsers } from "../helpers/users.ts";

let tenant: PaymentsTenant;

function chargeRows(appointmentId: string): Array<Record<string, unknown>> {
  const output = sql(
    `select coalesce(json_agg(json_build_object(
              'id', id, 'status', status, 'amount_cents', amount_cents,
              'asaas_payment_id', asaas_payment_id, 'pix_qr_code', pix_qr_code
            ) order by created_at), '[]'::json)
       from public.charges
      where tenant_id = :'tenant'::uuid and appointment_id = :'appointment'::uuid;`,
    { tenant: tenant.tenantId, appointment: appointmentId },
  );
  return JSON.parse(output) as Array<Record<string, unknown>>;
}

function pixLineCount(appointmentId: string): number {
  return Number(
    sql(
      `select count(*) from public.appointment_payments
        where tenant_id = :'tenant'::uuid and appointment_id = :'appointment'::uuid
          and method = 'pix_sistema';`,
      { tenant: tenant.tenantId, appointment: appointmentId },
    ),
  );
}

beforeAll(async () => {
  tenant = await createPaymentsTenant("payments-gateway");
  await seedAsaasConfig({
    tenantId: tenant.tenantId,
    encryptedKey: encryptAsaasKey("chave-de-teste"),
    active: true,
  });
});

afterAll(async () => {
  await cleanupPaymentFixtures([tenant.tenantId]);
  await deleteTestUsers();
});

describe("RF-14 create-charge com gateway fechado", () => {
  it("422 GATEWAY_ERROR deixa reserva cancelada e nenhum QR/asaas id", async () => {
    const fixture = await seedAppointment(tenant.tenantId, {
      status: "concluido",
      priceCents: 10_000,
    });
    await seedPayment({
      tenantId: tenant.tenantId,
      appointmentId: fixture.appointmentId,
      amountCents: 6_000,
    });
    const key = randomUUID();

    const response = await callFunction("create-charge", {
      token: tenant.admin.accessToken,
      body: {
        appointment_id: fixture.appointmentId,
        amount_cents: 3_000,
        idempotency_key: key,
      },
    });
    expect(response.status).toBe(422);
    expect(response.json?.code).toBe("GATEWAY_ERROR");

    const rows = chargeRows(fixture.appointmentId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      status: "cancelado",
      amount_cents: 3_000,
      asaas_payment_id: null,
      pix_qr_code: null,
    });
    expect(pixLineCount(fixture.appointmentId)).toBe(0);

    // Retry com a mesma chave reabre a reserva e falha de novo sem criar segunda cobrança.
    const retry = await callFunction("create-charge", {
      token: tenant.admin.accessToken,
      body: {
        appointment_id: fixture.appointmentId,
        amount_cents: 3_000,
        idempotency_key: key,
      },
    });
    expect(retry.status).toBe(422);
    expect(chargeRows(fixture.appointmentId)).toHaveLength(1);
  });

  it("saldo insuficiente => 409 AMOUNT_EXCEEDS_REMAINING sem criar cobrança", async () => {
    const fixture = await seedAppointment(tenant.tenantId, {
      status: "concluido",
      priceCents: 10_000,
    });
    await seedPayment({
      tenantId: tenant.tenantId,
      appointmentId: fixture.appointmentId,
      amountCents: 9_000,
    });

    const response = await callFunction("create-charge", {
      token: tenant.admin.accessToken,
      body: {
        appointment_id: fixture.appointmentId,
        amount_cents: 5_000,
        idempotency_key: randomUUID(),
      },
    });
    expect(response.status).toBe(409);
    expect(response.json?.code).toBe("AMOUNT_EXCEEDS_REMAINING");
    expect(chargeRows(fixture.appointmentId)).toHaveLength(0);
  });

  it("tenant sem config => 422 ASAAS_NOT_CONFIGURED antes de reservar", async () => {
    const other = await createPaymentsTenant("payments-gateway-no-config");
    try {
      const fixture = await seedAppointment(other.tenantId, {
        status: "concluido",
        priceCents: 10_000,
      });
      const response = await callFunction("create-charge", {
        token: other.admin.accessToken,
        body: {
          appointment_id: fixture.appointmentId,
          amount_cents: 3_000,
          idempotency_key: randomUUID(),
        },
      });
      expect(response.status).toBe(422);
      expect(response.json?.code).toBe("ASAAS_NOT_CONFIGURED");
      expect(chargeRows(fixture.appointmentId)).toHaveLength(0);
    } finally {
      await cleanupPaymentFixtures([other.tenantId]);
    }
  });
});

describe("RF-03/RF-14 register com parcela PIX e gateway fechado", () => {
  it("422 com settlement persistido, cobrança cancelada e zero linha pix_sistema", async () => {
    const fixture = await seedAppointment(tenant.tenantId, {
      status: "em_atendimento",
      priceCents: 10_000,
    });
    const key = randomUUID();
    const body = {
      appointment_id: fixture.appointmentId,
      idempotency_key: key,
      close_appointment: true,
      payments: [
        { method: "dinheiro", amount_cents: 7_000 },
        { method: "pix_sistema", amount_cents: 3_000 },
      ],
    };

    const response = await callFunction("register-appointment-payments", {
      token: tenant.admin.accessToken,
      body,
    });
    expect(response.status).toBe(422);
    const payload = response.json as Record<string, any>;
    expect(payload.code).toBe("GATEWAY_ERROR");
    expect(payload.retryable).toBe(true);
    expect(payload.pix_amount_cents).toBe(3_000);
    expect(payload.settlement.total_paid_cents).toBe(7_000);
    expect(payload.settlement.payment_status).toBe("parcial");
    expect(payload.settlement.reserved_cents).toBe(0);

    expect(pixLineCount(fixture.appointmentId)).toBe(0);
    expect(chargeRows(fixture.appointmentId)).toHaveLength(1);
    expect(chargeRows(fixture.appointmentId)[0]).toMatchObject({ status: "cancelado" });

    const status = await serviceClient()
      .from("appointments")
      .select("status")
      .eq("id", fixture.appointmentId)
      .single();
    expect(status.data?.status).toBe("concluido");

    // Retry idempotente do lote: replay não reserva de novo nem chama o gateway.
    // A reserva anterior ficou cancelada; a resposta é 200 com charge null.
    const retry = await callFunction("register-appointment-payments", {
      token: tenant.admin.accessToken,
      body,
    });
    expect(retry.status).toBe(200);
    expect(retry.json?.replayed).toBe(true);
    expect(retry.json?.charge).toBeNull();
    expect(
      Number(
        sql(
          `select count(*) from public.appointment_payments
            where tenant_id = :'tenant'::uuid and appointment_id = :'appointment'::uuid;`,
          { tenant: tenant.tenantId, appointment: fixture.appointmentId },
        ),
      ),
    ).toBe(1);
    expect(chargeRows(fixture.appointmentId)).toHaveLength(1);
  });
});

describe("FIX-2 replay com PIX", () => {
  it("PIX pago e PIX cancelado => 200 replayed=true, charge null, sem novo POST", async () => {
    for (const terminalStatus of ["pago", "cancelado"] as const) {
      const fixture = await seedAppointment(tenant.tenantId, {
        status: "em_atendimento",
        priceCents: 10_000,
      });
      const key = randomUUID();
      const body = {
        appointment_id: fixture.appointmentId,
        idempotency_key: key,
        close_appointment: true,
        payments: [
          { method: "dinheiro", amount_cents: 6_000 },
          { method: "pix_sistema", amount_cents: 4_000 },
        ],
      };

      const persisted = await serviceClient().rpc("register_appointment_payments", {
        p_tenant_id: tenant.tenantId,
        p_actor_id: tenant.admin.id,
        p_appointment_id: fixture.appointmentId,
        p_payments: body.payments,
        p_idempotency_key: key,
        p_close_appointment: true,
      });
      expect(persisted.error).toBeNull();

      const chargeId = await seedCharge({
        tenantId: tenant.tenantId,
        appointmentId: fixture.appointmentId,
        amountCents: 4_000,
        status: terminalStatus === "pago" ? "pendente" : "cancelado",
        expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      });

      if (terminalStatus === "pago") {
        const settled = await serviceClient().rpc("settle_charge_payment", {
          p_tenant_id: tenant.tenantId,
          p_charge_id: chargeId,
          p_paid_at: null,
          p_source: "asaas",
          p_actor_id: null,
          p_event_id: "evt-replay",
        });
        expect(settled.error).toBeNull();
      }

      const replay = await callFunction("register-appointment-payments", {
        token: tenant.admin.accessToken,
        body,
      });
      expect(replay.status).toBe(200);
      expect(replay.json?.replayed).toBe(true);
      expect(replay.json?.charge).toBeNull();
      const settlement = replay.json?.settlement as Record<string, unknown> | undefined;
      expect(settlement?.total_paid_cents).toBe(terminalStatus === "pago" ? 10_000 : 6_000);

      expect(chargeRows(fixture.appointmentId)).toHaveLength(1);
      expect(pixLineCount(fixture.appointmentId)).toBe(terminalStatus === "pago" ? 1 : 0);
    }
  });
});

describe("FIX-4 reemissão com gateway indisponível", () => {
  it("falha ao cancelar anterior => 422 GATEWAY_CANCEL_FAILED sem reabrir e sem novo POST", async () => {
    const fixture = await seedAppointment(tenant.tenantId, {
      status: "concluido",
      priceCents: 10_000,
    });
    const chargeId = await seedCharge({
      tenantId: tenant.tenantId,
      appointmentId: fixture.appointmentId,
      amountCents: 3_000,
      status: "expirado",
      asaasPaymentId: "pay-old",
      expiresAt: new Date(Date.now() - 60_000).toISOString(),
    });

    const response = await callFunction("create-charge", {
      token: tenant.admin.accessToken,
      body: {
        appointment_id: fixture.appointmentId,
        amount_cents: 3_000,
        idempotency_key: randomUUID(),
      },
    });
    expect(response.status).toBe(422);
    expect(response.json?.code).toBe("GATEWAY_CANCEL_FAILED");
    expect(chargeRows(fixture.appointmentId)).toEqual([
      expect.objectContaining({
        id: chargeId,
        status: "expirado",
        amount_cents: 3_000,
        asaas_payment_id: "pay-old",
        pix_qr_code: null,
      }),
    ]);
  });

  it("cobrança paga => 409 CHARGE_NOT_PENDING e nunca reemite", async () => {
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

    const response = await callFunction("create-charge", {
      token: tenant.admin.accessToken,
      body: {
        appointment_id: fixture.appointmentId,
        amount_cents: 3_000,
        idempotency_key: randomUUID(),
      },
    });
    expect(response.status).toBe(409);
    expect(response.json?.code).toBe("CHARGE_NOT_PENDING");
    expect(chargeRows(fixture.appointmentId)).toEqual([
      expect.objectContaining({ id: chargeId, status: "pago", asaas_payment_id: "pay-paid" }),
    ]);
  });
});
