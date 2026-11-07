// Webhook do Asaas contra Postgres real + Edge servida (ADR-003; RF-08..RF-14, RF-16..RF-19).
// Nenhum teste chama o Asaas: o gateway aponta para uma porta fechada no env das funções.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { serviceClient } from "../helpers/clients.ts";
import { readFunctionsEnv } from "../helpers/env.ts";
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

const functionsEnv = readFunctionsEnv();
const GLOBAL_TOKEN = (functionsEnv.ASAAS_WEBHOOK_TOKEN ?? "").trim();
const PAID_AT = "2026-11-06";

let tenantA: PaymentsTenant;
let tenantB: PaymentsTenant;
let tokenA = "";
let tokenB = "";

beforeAll(async () => {
  if (!GLOBAL_TOKEN) {
    throw new Error(
      "ASAAS_WEBHOOK_TOKEN ausente em supabase/functions/.env: a suíte não consegue testar o token global.",
    );
  }
  tenantA = await createPaymentsTenant("webhook-a");
  tenantB = await createPaymentsTenant("webhook-b");
  tokenA = `whsec-${randomUUID()}`;
  tokenB = `whsec-${randomUUID()}`;
  await seedAsaasConfig({
    tenantId: tenantA.tenantId,
    encryptedKey: encryptAsaasKey("x"),
    webhookToken: tokenA,
  });
  await seedAsaasConfig({
    tenantId: tenantB.tenantId,
    encryptedKey: encryptAsaasKey("x"),
    webhookToken: tokenB,
  });
});

afterAll(async () => {
  await cleanupPaymentFixtures([tenantA.tenantId, tenantB.tenantId]);
  await deleteTestUsers();
});

function count(query: string, vars: Record<string, string> = {}): number {
  return Number(sql(query, vars));
}

async function pendingCharge(
  tenant: PaymentsTenant,
  amountCents: number,
): Promise<{ chargeId: string; appointmentId: string; paymentId: string }> {
  const appointment = await seedAppointment(tenant.tenantId, { priceCents: amountCents });
  const paymentId = `pay-${randomUUID()}`;
  const chargeId = await seedCharge({
    tenantId: tenant.tenantId,
    appointmentId: appointment.appointmentId,
    amountCents,
    status: "pendente",
    asaasPaymentId: paymentId,
  });
  return { chargeId, appointmentId: appointment.appointmentId, paymentId };
}

function eventBody(
  paymentId: string,
  overrides: { id?: string; event?: string; value?: unknown; date?: string | null } = {},
): Record<string, unknown> {
  const payment: Record<string, unknown> = { id: paymentId };
  if (overrides.value !== undefined) payment.value = overrides.value;
  if (overrides.date !== null) {
    payment.paymentDate = overrides.date ?? PAID_AT;
  }
  return {
    id: overrides.id ?? `evt-${randomUUID()}`,
    event: overrides.event ?? "PAYMENT_RECEIVED",
    payment,
  };
}

async function post(token: string, body: Record<string, unknown>) {
  return callFunction("asaas-webhook", {
    headers: { "asaas-access-token": token },
    body,
  });
}

async function chargeRow(chargeId: string): Promise<{ status: string; paid_at: string | null }> {
  const { data, error } = await serviceClient()
    .from("charges")
    .select("status, paid_at")
    .eq("id", chargeId)
    .maybeSingle();
  if (error) throw new Error(`Leitura de charge falhou (código ${error.code ?? "vazio"}).`);
  return data as { status: string; paid_at: string | null };
}

async function latestAudit(action: string, targetId: string | null) {
  let query = serviceClient()
    .from("audit_log")
    .select("action, tenant_id, metadata")
    .eq("action", action)
    .order("created_at", { ascending: false })
    .limit(1);
  if (targetId !== null) query = query.eq("target_id", targetId);
  const { data, error } = await query;
  if (error) throw new Error(`Leitura de audit_log falhou (código ${error.code ?? "vazio"}).`);
  return (data?.[0] ?? null) as
    | { action: string; tenant_id: string | null; metadata: Record<string, unknown> }
    | null;
}

describe("RF-08 recebimento idempotente", () => {
  it("PAYMENT_RECEIVED cria uma linha no ledger e marca a cobrança como paga", async () => {
    const charge = await pendingCharge(tenantA, 3_000);
    const body = eventBody(charge.paymentId, { value: 30 });

    const response = await post(tokenA, body);
    expect(response.status).toBe(200);

    expect(
      count(
        `select count(*) from public.appointment_payments
          where tenant_id = :'tenant'::uuid and charge_id = :'charge'::uuid;`,
        { tenant: tenantA.tenantId, charge: charge.chargeId },
      ),
    ).toBe(1);
    expect(
      sql(
        `select method || '|' || source || '|' || amount_cents || '|' || tip_cents
           from public.appointment_payments
          where tenant_id = :'tenant'::uuid and charge_id = :'charge'::uuid;`,
        { tenant: tenantA.tenantId, charge: charge.chargeId },
      ),
    ).toBe("pix_sistema|asaas|3000|0");

    const row = await chargeRow(charge.chargeId);
    expect(row.status).toBe("pago");
    expect(row.paid_at).not.toBeNull();

    expect(
      count(
        `select count(*) from public.webhook_events
          where tenant_id = :'tenant'::uuid and event_id = :'event' and payment_id = :'payment'
            and processed_at is not null and payload = '{}'::jsonb;`,
        { tenant: tenantA.tenantId, event: String(body.id), payment: charge.paymentId },
      ),
    ).toBe(1);
  });

  it("reenvio do mesmo id não cria segunda linha", async () => {
    const charge = await pendingCharge(tenantA, 3_000);
    const body = eventBody(charge.paymentId, { value: 30 });

    expect((await post(tokenA, body)).status).toBe(200);
    expect((await post(tokenA, body)).status).toBe(200);

    expect(
      count(
        `select count(*) from public.appointment_payments where charge_id = :'charge'::uuid;`,
        { charge: charge.chargeId },
      ),
    ).toBe(1);
    expect(
      count(
        `select count(*) from public.webhook_events where event_id = :'event' and payment_id = :'payment';`,
        { event: String(body.id), payment: charge.paymentId },
      ),
    ).toBe(1);
  });

  it("novo id para o mesmo payment não cria segunda linha (replayed)", async () => {
    const charge = await pendingCharge(tenantA, 2_500);
    expect((await post(tokenA, eventBody(charge.paymentId, { value: 25 }))).status).toBe(200);

    const replay = eventBody(charge.paymentId, { value: 25 });
    expect((await post(tokenA, replay)).status).toBe(200);

    expect(
      count(
        `select count(*) from public.appointment_payments where charge_id = :'charge'::uuid;`,
        { charge: charge.chargeId },
      ),
    ).toBe(1);
    expect(
      count(
        `select count(*) from public.webhook_events where payment_id = :'payment'
            and processed_at is not null;`,
        { payment: charge.paymentId },
      ),
    ).toBe(2);
  });

  it("duas entregas simultâneas do mesmo id produzem uma única linha", async () => {
    const charge = await pendingCharge(tenantA, 4_000);
    const body = eventBody(charge.paymentId, { value: 40 });

    const responses = await Promise.all([post(tokenA, body), post(tokenA, body)]);
    expect(responses.map((response) => response.status)).toEqual([200, 200]);

    expect(
      count(
        `select count(*) from public.appointment_payments where charge_id = :'charge'::uuid;`,
        { charge: charge.chargeId },
      ),
    ).toBe(1);
  });

  it("baixa manual anterior não cria segunda linha", async () => {
    const charge = await pendingCharge(tenantA, 3_000);
    const { error } = await serviceClient().rpc("settle_charge_payment", {
      p_tenant_id: tenantA.tenantId,
      p_charge_id: charge.chargeId,
      p_paid_at: new Date().toISOString(),
      p_source: "manual",
      p_actor_id: tenantA.admin.id,
      p_event_id: null,
    });
    expect(error).toBeNull();

    expect((await post(tokenA, eventBody(charge.paymentId, { value: 30 }))).status).toBe(200);

    expect(
      count(
        `select count(*) from public.appointment_payments where charge_id = :'charge'::uuid;`,
        { charge: charge.chargeId },
      ),
    ).toBe(1);
    expect(
      sql(
        `select source from public.appointment_payments where charge_id = :'charge'::uuid;`,
        { charge: charge.chargeId },
      ),
    ).toBe("manual");
  });
});

describe("RF-10 pagamento em cobrança cancelada", () => {
  it("não cria receita e audita charge_paid_after_cancel", async () => {
    const appointment = await seedAppointment(tenantA.tenantId, { priceCents: 3_000 });
    const paymentId = `pay-${randomUUID()}`;
    const chargeId = await seedCharge({
      tenantId: tenantA.tenantId,
      appointmentId: appointment.appointmentId,
      amountCents: 3_000,
      status: "cancelado",
      asaasPaymentId: paymentId,
    });

    const response = await post(tokenA, eventBody(paymentId, { value: 30 }));
    expect(response.status).toBe(200);

    expect(
      count(`select count(*) from public.appointment_payments where charge_id = :'charge'::uuid;`, {
        charge: chargeId,
      }),
    ).toBe(0);
    const audit = await latestAudit("charge_paid_after_cancel", chargeId);
    expect(audit).not.toBeNull();
    expect(audit?.tenant_id).toBe(tenantA.tenantId);
  });
});

describe("RF-11 overdue/deleted nunca rebaixam pago", () => {
  it("PAYMENT_OVERDUE em cobrança paga mantém o status", async () => {
    const charge = await pendingCharge(tenantA, 3_000);
    await serviceClient().from("charges").update({ status: "pago", paid_at: new Date().toISOString() }).eq("id", charge.chargeId);
    await seedPayment({
      tenantId: tenantA.tenantId,
      appointmentId: charge.appointmentId,
      method: "pix_sistema",
      amountCents: 3_000,
      source: "asaas",
      chargeId: charge.chargeId,
    });

    const response = await post(
      tokenA,
      eventBody(charge.paymentId, { event: "PAYMENT_OVERDUE", date: null }),
    );
    expect(response.status).toBe(200);
    expect((await chargeRow(charge.chargeId)).status).toBe("pago");
    expect(await latestAudit("charge_expired", charge.chargeId)).toBeNull();
  });

  it("PAYMENT_OVERDUE em pendente vira expirado", async () => {
    const charge = await pendingCharge(tenantA, 1_500);
    const response = await post(
      tokenA,
      eventBody(charge.paymentId, { event: "PAYMENT_OVERDUE", date: null }),
    );
    expect(response.status).toBe(200);
    expect((await chargeRow(charge.chargeId)).status).toBe("expirado");
    expect(await latestAudit("charge_expired", charge.chargeId)).not.toBeNull();
  });

  it("PAYMENT_DELETED em pago mantém o status", async () => {
    const charge = await pendingCharge(tenantA, 2_000);
    await serviceClient().from("charges").update({ status: "pago", paid_at: new Date().toISOString() }).eq("id", charge.chargeId);
    await seedPayment({
      tenantId: tenantA.tenantId,
      appointmentId: charge.appointmentId,
      method: "pix_sistema",
      amountCents: 2_000,
      source: "asaas",
      chargeId: charge.chargeId,
    });

    const response = await post(
      tokenA,
      eventBody(charge.paymentId, { event: "PAYMENT_DELETED", date: null }),
    );
    expect(response.status).toBe(200);
    expect((await chargeRow(charge.chargeId)).status).toBe("pago");
    expect(await latestAudit("charge_deleted_gateway", charge.chargeId)).toBeNull();
  });
});

describe("RF-16 valor divergente", () => {
  it("liquida pelo valor da cobrança e audita payment_amount_mismatch", async () => {
    const charge = await pendingCharge(tenantA, 3_000);
    const response = await post(tokenA, eventBody(charge.paymentId, { value: 20 }));
    expect(response.status).toBe(200);

    expect(
      sql(
        `select amount_cents from public.appointment_payments where charge_id = :'charge'::uuid;`,
        { charge: charge.chargeId },
      ),
    ).toBe("3000");

    const audit = await latestAudit("payment_amount_mismatch", charge.chargeId);
    expect(audit).not.toBeNull();
    expect(audit?.metadata.amount_cents).toBe(3_000);
    expect(audit?.metadata.payment_value_cents).toBe(2_000);
  });
});

describe("RF-17 refund/chargeback fora do v1", () => {
  it("audita gateway_refund_out_of_scope sem criar receita", async () => {
    const charge = await pendingCharge(tenantA, 3_000);
    const response = await post(
      tokenA,
      eventBody(charge.paymentId, { event: "PAYMENT_PARTIALLY_REFUNDED", value: 30 }),
    );
    expect(response.status).toBe(200);

    expect(
      count(`select count(*) from public.appointment_payments where charge_id = :'charge'::uuid;`, {
        charge: charge.chargeId,
      }),
    ).toBe(0);
    expect((await chargeRow(charge.chargeId)).status).toBe("pendente");
    expect(await latestAudit("gateway_refund_out_of_scope", charge.chargeId)).not.toBeNull();
  });
});

describe("RF-18 cobrança desconhecida", () => {
  it("responde 200, audita com tenant nulo e não cria dedupe", async () => {
    const paymentId = `pay-unknown-${randomUUID()}`;
    const body = eventBody(paymentId, { value: 10 });

    const response = await post(GLOBAL_TOKEN, body);
    expect(response.status).toBe(200);

    expect(
      count(`select count(*) from public.webhook_events where event_id = :'event';`, {
        event: String(body.id),
      }),
    ).toBe(0);

    const audit = await latestAudit("charge_unknown_webhook", null);
    expect(audit).not.toBeNull();
    expect(audit?.tenant_id).toBeNull();
    expect(audit?.metadata.payment_id).toBe(paymentId);
  });
});

describe("RF-19 autenticação", () => {
  it("token inválido responde 401 sem criar webhook_event", async () => {
    const charge = await pendingCharge(tenantA, 3_000);
    const body = eventBody(charge.paymentId, { value: 30 });

    const response = await post("token-errado", body);
    expect(response.status).toBe(401);

    expect(
      count(`select count(*) from public.webhook_events where event_id = :'event';`, {
        event: String(body.id),
      }),
    ).toBe(0);
    expect(
      count(`select count(*) from public.appointment_payments where charge_id = :'charge'::uuid;`, {
        charge: charge.chargeId,
      }),
    ).toBe(0);
  });

  it("token de outro tenant não toca a cobrança", async () => {
    const charge = await pendingCharge(tenantA, 3_000);
    const body = eventBody(charge.paymentId, { value: 30 });

    const response = await post(tokenB, body);
    expect(response.status).toBe(401);
    expect(
      count(`select count(*) from public.appointment_payments where charge_id = :'charge'::uuid;`, {
        charge: charge.chargeId,
      }),
    ).toBe(0);
    expect(
      count(`select count(*) from public.webhook_events where event_id = :'event';`, {
        event: String(body.id),
      }),
    ).toBe(0);
  });
});

describe("BE-07 dedupe durável de webhook_events", () => {
  it("insert sem processed_at grava null", async () => {
    const { data, error } = await serviceClient()
      .from("webhook_events")
      .insert({
        tenant_id: tenantA.tenantId,
        source: "asaas",
        external_event_id: `direct-${randomUUID()}`,
        instance_name: "asaas",
        status: "recebido",
        payload: {},
      })
      .select("processed_at")
      .single();
    expect(error).toBeNull();
    expect(data?.processed_at).toBeNull();
  });

  it("source fora do enum é rejeitado pelo banco", async () => {
    const { error } = await serviceClient().from("webhook_events").insert({
      tenant_id: tenantA.tenantId,
      source: "outro",
      external_event_id: `outro-${randomUUID()}`,
      instance_name: "teste",
      status: "recebido",
      payload: {},
    });
    expect(error).not.toBeNull();
    expect(error?.code).toBe("23514");
  });
});

describe("RF-14 payload nunca é persistido", () => {
  it("todas as linhas de webhook_events têm payload vazio", () => {
    expect(
      count(
        `select count(*) from public.webhook_events
          where tenant_id in (:'tenant_a'::uuid, :'tenant_b'::uuid)
            and payload <> '{}'::jsonb;`,
        { tenant_a: tenantA.tenantId, tenant_b: tenantB.tenantId },
      ),
    ).toBe(0);
  });
});
