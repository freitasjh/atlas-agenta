// Matriz de integração do PDV balcão walk-in (ADR-21..25; analysis-data §9.2).
// PostgreSQL real (nunca mock/H2): RLS provada com sessões JWT reais; escrita privilegiada
// pela service role, como a Edge `create-walk-in` faz. Limpeza pelos helpers existentes.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { serviceClient } from "../helpers/clients.ts";
import { callFunction } from "../helpers/functions.ts";
import {
  callCreateWalkIn,
  cleanupPaymentFixtures,
  createPaymentsTenant,
  getAppointmentStatus,
  seedAppointment,
  seedCommissionPct,
  seedWalkInCatalog,
  setTenantSegment,
  type PaymentsTenant,
  type WalkInCatalog,
} from "../helpers/payments-fixtures.ts";
import { sql } from "../helpers/sql.ts";
import { createTenantMember, deleteTestUsers, type TestUser } from "../helpers/users.ts";
import { errorResponse, mapRpcError } from "../../../supabase/functions/_shared/http.ts";

const tenantsToCleanup: string[] = [];

const FROM = new Date(Date.now() - 3_600_000).toISOString();
const TO = new Date(Date.now() + 3_600_000).toISOString();

async function newTenant(prefix: string): Promise<PaymentsTenant> {
  const tenant = await createPaymentsTenant(prefix);
  tenantsToCleanup.push(tenant.tenantId);
  // Plano clínica (5 profissionais, sem teto mensal de agenda): as fixtures do PDV abrem
  // vários profissionais no mesmo tenant; o plano individual trava no 2º (PLAN_LIMIT 23514).
  const { error } = await serviceClient()
    .from("tenants")
    .update({ plan: "clinica" })
    .eq("id", tenant.tenantId);
  if (error) throw new Error(`Ajuste de plano falhou (código ${error.code ?? "vazio"}).`);
  return tenant;
}

function register(
  tenantId: string,
  actorId: string,
  appointmentId: string,
  payments: Array<Record<string, unknown>>,
  idempotencyKey: string,
  close = true,
) {
  return serviceClient().rpc("register_appointment_payments", {
    p_tenant_id: tenantId,
    p_actor_id: actorId,
    p_appointment_id: appointmentId,
    p_payments: payments,
    p_idempotency_key: idempotencyKey,
    p_close_appointment: close,
  });
}

function reserve(tenantId: string, actorId: string, appointmentId: string, amountCents: number, key: string) {
  return serviceClient().rpc("reserve_appointment_charge", {
    p_tenant_id: tenantId,
    p_actor_id: actorId,
    p_appointment_id: appointmentId,
    p_amount_cents: amountCents,
    p_idempotency_key: key,
    p_expires_at: new Date(Date.now() + 3_600_000).toISOString(),
  });
}

function settle(tenantId: string, chargeId: string, eventId: string) {
  return serviceClient().rpc("settle_charge_payment", {
    p_tenant_id: tenantId,
    p_charge_id: chargeId,
    p_paid_at: new Date().toISOString(),
    p_source: "asaas",
    p_actor_id: null,
    p_event_id: eventId,
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

async function summaryAs(user: TestUser, from = FROM, to = TO) {
  return user.client.rpc("financial_summary", { p_from: from, p_to: to });
}

function ledgerCount(tenantId: string, appointmentId: string): number {
  return Number(
    sql(
      `select count(*) from public.appointment_payments
        where tenant_id = :'tenant'::uuid and appointment_id = :'appointment'::uuid;`,
      { tenant: tenantId, appointment: appointmentId },
    ),
  );
}

function commissionCents(tenantId: string, appointmentId: string): number | null {
  const out = sql(
    `select commission_cents from public.appointment_commissions
      where tenant_id = :'tenant'::uuid and appointment_id = :'appointment'::uuid;`,
    { tenant: tenantId, appointment: appointmentId },
  );
  return out === "" ? null : Number(out);
}

function appointmentCount(tenantId: string, professionalId?: string): number {
  if (professionalId === undefined) {
    return Number(
      sql(`select count(*) from public.appointments where tenant_id = :'tenant'::uuid;`, {
        tenant: tenantId,
      }),
    );
  }
  return Number(
    sql(
      `select count(*) from public.appointments
        where tenant_id = :'tenant'::uuid and professional_id = :'professional'::uuid;`,
      { tenant: tenantId, professional: professionalId },
    ),
  );
}

async function createWalkInOk(params: {
  tenantId: string;
  actorId: string;
  professionalId: string;
  serviceId: string;
  customerId?: string | null;
  creationIdempotencyKey?: string | null;
}): Promise<string> {
  const result = await callCreateWalkIn(params);
  expect(result.error).toBeNull();
  const id = String(result.data?.id ?? "");
  expect(id).not.toBe("");
  return id;
}

function edgeWalkIn(user: TestUser, body: Record<string, unknown>) {
  return callFunction("create-walk-in", { token: user.accessToken, body });
}

/**
 * Move a janela do atendimento sem tocar em `status` (o trigger só dispara em UPDATE OF status).
 * A RPC walk-in nasce em `now()`, então duas vendas do mesmo profissional na mesma fixture
 * colidiriam na exclusion global; mover a anterior libera a janela.
 */
async function moveWindow(
  tenantId: string,
  appointmentId: string,
  offsetMinutes: number,
): Promise<void> {
  const start = new Date(Date.now() + offsetMinutes * 60_000);
  const { error } = await serviceClient()
    .from("appointments")
    .update({
      starts_at: start.toISOString(),
      ends_at: new Date(start.getTime() + 30 * 60_000).toISOString(),
    })
    .eq("tenant_id", tenantId)
    .eq("id", appointmentId);
  if (error) throw new Error(`Movimento de janela falhou (código ${error.code ?? "vazio"}).`);
}

afterAll(async () => {
  await cleanupPaymentFixtures(tenantsToCleanup);
  await deleteTestUsers();
});

describe("RLS multi-tenant do walk-in", () => {
  let tenantA: PaymentsTenant;
  let tenantB: PaymentsTenant;
  let catalogA: WalkInCatalog;
  let catalogB: WalkInCatalog;

  beforeAll(async () => {
    tenantA = await newTenant("pdv-rls-a");
    tenantB = await newTenant("pdv-rls-b");
    catalogA = await seedWalkInCatalog(tenantA.tenantId, { withCustomer: true });
    catalogB = await seedWalkInCatalog(tenantB.tenantId, { withCustomer: true });
  });

  it("INSERT de walk-in com tenant alheio é negado pela RLS (42501)", async () => {
    const startsAt = new Date(Date.now() + 7_200_000);
    const { error } = await tenantA.admin.client.from("appointments").insert({
      tenant_id: tenantB.tenantId,
      origin: "walk_in",
      customer_id: catalogB.customerId,
      professional_id: catalogB.professionalId,
      service_id: catalogB.serviceId,
      starts_at: startsAt.toISOString(),
      ends_at: new Date(startsAt.getTime() + 1_800_000).toISOString(),
      price_cents: 10_000,
      status: "em_atendimento",
    });
    expect(error?.code).toBe("42501");
  });

  it("SELECT cross-tenant não devolve a venda do outro tenant", async () => {
    const walkInB = await createWalkInOk({
      tenantId: tenantB.tenantId,
      actorId: tenantB.admin.id,
      professionalId: catalogB.professionalId,
      serviceId: catalogB.serviceId,
    });

    const cross = await tenantA.admin.client
      .from("appointments")
      .select("id")
      .eq("id", walkInB);
    expect(cross.error).toBeNull();
    expect(cross.data ?? []).toHaveLength(0);

    const own = await tenantB.admin.client.from("appointments").select("id").eq("id", walkInB);
    expect(own.error).toBeNull();
    expect(own.data ?? []).toHaveLength(1);
  });

  it("customer_id de outro tenant é rejeitado (RPC PT404 e FK composta 23503)", async () => {
    const viaRpc = await callCreateWalkIn({
      tenantId: tenantA.tenantId,
      actorId: tenantA.admin.id,
      professionalId: catalogA.professionalId,
      serviceId: catalogA.serviceId,
      customerId: catalogB.customerId,
    });
    expect(viaRpc.error?.code).toBe("PT404");
    expect(viaRpc.error?.message).toBe("CUSTOMER_NOT_FOUND");

    const startsAt = new Date(Date.now() + 9_000_000);
    const direct = await serviceClient().from("appointments").insert({
      tenant_id: tenantA.tenantId,
      origin: "walk_in",
      customer_id: catalogB.customerId,
      professional_id: catalogA.professionalId,
      service_id: catalogA.serviceId,
      starts_at: startsAt.toISOString(),
      ends_at: new Date(startsAt.getTime() + 1_800_000).toISOString(),
      price_cents: 10_000,
      status: "em_atendimento",
    });
    expect(direct.error?.code).toBe("23503");
  });
});

describe("Cliente nulo no walk-in", () => {
  let tenant: PaymentsTenant;
  let catalog: WalkInCatalog;
  let withCustomer: WalkInCatalog;

  beforeAll(async () => {
    tenant = await newTenant("pdv-null-customer");
    catalog = await seedWalkInCatalog(tenant.tenantId);
    withCustomer = await seedWalkInCatalog(tenant.tenantId, { withCustomer: true });
  });

  it("walk-in anônimo percorre em_atendimento → concluido sem cliente", async () => {
    const appointmentId = await createWalkInOk({
      tenantId: tenant.tenantId,
      actorId: tenant.admin.id,
      professionalId: catalog.professionalId,
      serviceId: catalog.serviceId,
    });

    const row = await serviceClient()
      .from("appointments")
      .select("customer_id, origin, status")
      .eq("id", appointmentId)
      .single();
    expect(row.error).toBeNull();
    expect(row.data).toMatchObject({
      customer_id: null,
      origin: "walk_in",
      status: "em_atendimento",
    });

    const concluded = await register(
      tenant.tenantId,
      tenant.admin.id,
      appointmentId,
      [{ method: "dinheiro", amount_cents: 10_000 }],
      randomUUID(),
      true,
    );
    expect(concluded.error).toBeNull();
    expect(await getAppointmentStatus(appointmentId)).toBe("concluido");

    await moveWindow(tenant.tenantId, appointmentId, -180);
  });

  it("agendado sem cliente é rejeitado pelo CHECK (23514)", async () => {
    const startsAt = new Date(Date.now() + 11_000_000);
    const { error } = await serviceClient().from("appointments").insert({
      tenant_id: tenant.tenantId,
      origin: "agendado",
      customer_id: null,
      professional_id: catalog.professionalId,
      service_id: catalog.serviceId,
      starts_at: startsAt.toISOString(),
      ends_at: new Date(startsAt.getTime() + 1_800_000).toISOString(),
      price_cents: 10_000,
      status: "pendente",
    });
    expect(error?.code).toBe("23514");
  });

  it("ficha clínica sobre walk-in anônimo é rejeitada pela FK composta (23503)", async () => {
    const appointmentId = await createWalkInOk({
      tenantId: tenant.tenantId,
      actorId: tenant.admin.id,
      professionalId: catalog.professionalId,
      serviceId: catalog.serviceId,
    });

    const { error } = await serviceClient().from("clinical_records").insert({
      tenant_id: tenant.tenantId,
      customer_id: withCustomer.customerId,
      appointment_id: appointmentId,
      created_by: tenant.admin.id,
      allergies: "teste",
    });
    expect(error?.code).toBe("23503");
  });
});

describe("Máquina de estados e guarda de comissão", () => {
  let tenant: PaymentsTenant;
  let catalog: WalkInCatalog;

  beforeAll(async () => {
    tenant = await newTenant("pdv-state");
    catalog = await seedWalkInCatalog(tenant.tenantId);
  });

  it("pendente → concluido direto é rejeitado (23514)", async () => {
    const fixture = await seedAppointment(tenant.tenantId, { status: "pendente" });
    const { error } = await serviceClient()
      .from("appointments")
      .update({ status: "concluido" })
      .eq("id", fixture.appointmentId);
    expect(error?.code).toBe("23514");
    expect(await getAppointmentStatus(fixture.appointmentId)).toBe("pendente");
  });

  it("INSERT direto em concluido não dispara o gancho de comissão", async () => {
    const startsAt = new Date(Date.now() + 13_000_000);
    const inserted = await serviceClient()
      .from("appointments")
      .insert({
        tenant_id: tenant.tenantId,
        origin: "walk_in",
        customer_id: null,
        professional_id: catalog.professionalId,
        service_id: catalog.serviceId,
        starts_at: startsAt.toISOString(),
        ends_at: new Date(startsAt.getTime() + 1_800_000).toISOString(),
        price_cents: 10_000,
        status: "concluido",
      })
      .select("id")
      .single();
    expect(inserted.error).toBeNull();
    expect(commissionCents(tenant.tenantId, inserted.data?.id as string)).toBeNull();
  });

  it("em_atendimento → concluido pelo register apura a comissão", async () => {
    const appointmentId = await createWalkInOk({
      tenantId: tenant.tenantId,
      actorId: tenant.admin.id,
      professionalId: catalog.professionalId,
      serviceId: catalog.serviceId,
    });
    const { error } = await register(
      tenant.tenantId,
      tenant.admin.id,
      appointmentId,
      [],
      randomUUID(),
      true,
    );
    expect(error).toBeNull();
    expect(await getAppointmentStatus(appointmentId)).toBe("concluido");
    expect(commissionCents(tenant.tenantId, appointmentId)).toBe(0);
  });
});

describe("Comissão do walk-in (snapshot, base e relatório)", () => {
  let tenant: PaymentsTenant;
  let profX: WalkInCatalog;
  let profY: WalkInCatalog;
  let serviceHigh: WalkInCatalog;

  beforeAll(async () => {
    tenant = await newTenant("pdv-commission");
    profX = await seedWalkInCatalog(tenant.tenantId, { priceCents: 4_500 });
    profY = await seedWalkInCatalog(tenant.tenantId, { priceCents: 10_000 });
    serviceHigh = await seedWalkInCatalog(tenant.tenantId, { priceCents: 10_000 });
    await seedCommissionPct(tenant.tenantId, profX.professionalId, 33.33);
  });

  it("round(price × pct / 100) half-up: 4500 × 33,33% => 1500", async () => {
    const appointmentId = await createWalkInOk({
      tenantId: tenant.tenantId,
      actorId: tenant.admin.id,
      professionalId: profX.professionalId,
      serviceId: profX.serviceId,
    });
    const { error } = await register(
      tenant.tenantId,
      tenant.admin.id,
      appointmentId,
      [],
      randomUUID(),
      true,
    );
    expect(error).toBeNull();
    expect(commissionCents(tenant.tenantId, appointmentId)).toBe(1_500);

    await moveWindow(tenant.tenantId, appointmentId, -180);
  });

  it("profissional sem taxa apura 0 (nunca pula a linha)", async () => {
    const appointmentId = await createWalkInOk({
      tenantId: tenant.tenantId,
      actorId: tenant.admin.id,
      professionalId: profY.professionalId,
      serviceId: profY.serviceId,
    });
    const { error } = await register(
      tenant.tenantId,
      tenant.admin.id,
      appointmentId,
      [],
      randomUUID(),
      true,
    );
    expect(error).toBeNull();
    expect(commissionCents(tenant.tenantId, appointmentId)).toBe(0);
  });

  it("gorjeta fica fora da base de comissão", async () => {
    const appointmentId = await createWalkInOk({
      tenantId: tenant.tenantId,
      actorId: tenant.admin.id,
      professionalId: profX.professionalId,
      serviceId: serviceHigh.serviceId,
    });
    const { error } = await register(
      tenant.tenantId,
      tenant.admin.id,
      appointmentId,
      [{ method: "dinheiro", amount_cents: 10_000, tip_cents: 500 }],
      randomUUID(),
      true,
    );
    expect(error).toBeNull();
    // 10000 × 33,33% = 3333 (gorjeta de 500 não entra).
    expect(commissionCents(tenant.tenantId, appointmentId)).toBe(3_333);
  });

  it("report_commissions soma o walk-in do período", async () => {
    const { data, error } = await tenant.admin.client.rpc("report_commissions", {
      p_start: FROM,
      p_end: TO,
      p_professional_id: profX.professionalId,
    });
    expect(error).toBeNull();
    const rows = (data ?? []) as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(1);
    expect(Number(rows[0]?.total_commission_cents)).toBe(1_500 + 3_333);
    expect(Number(rows[0]?.appointment_count)).toBe(2);
  });
});

describe("Ledger: walk-in em dinheiro e parcial", () => {
  let tenantFull: PaymentsTenant;
  let catalogFull: WalkInCatalog;
  let tenantPartial: PaymentsTenant;
  let catalogPartial: WalkInCatalog;

  beforeAll(async () => {
    tenantFull = await newTenant("pdv-cash-full");
    catalogFull = await seedWalkInCatalog(tenantFull.tenantId, { priceCents: 10_000 });
    tenantPartial = await newTenant("pdv-cash-partial");
    catalogPartial = await seedWalkInCatalog(tenantPartial.tenantId, { priceCents: 10_000 });
  });

  it("dinheiro integral => quitado e receita no financial_summary", async () => {
    const appointmentId = await createWalkInOk({
      tenantId: tenantFull.tenantId,
      actorId: tenantFull.admin.id,
      professionalId: catalogFull.professionalId,
      serviceId: catalogFull.serviceId,
    });
    const { data, error } = await register(
      tenantFull.tenantId,
      tenantFull.admin.id,
      appointmentId,
      [{ method: "dinheiro", amount_cents: 10_000 }],
      randomUUID(),
      true,
    );
    expect(error).toBeNull();
    expect(data).toMatchObject({ payment_status: "quitado", appointment_status: "concluido" });

    const summary = await summaryAs(tenantFull.admin);
    expect(summary.error).toBeNull();
    expect(summary.data).toMatchObject({
      received_service_cents: 10_000,
      received_total_cents: 10_000,
      open_cents: 0,
    });
  });

  it("parcial => open > 0 no período", async () => {
    const appointmentId = await createWalkInOk({
      tenantId: tenantPartial.tenantId,
      actorId: tenantPartial.admin.id,
      professionalId: catalogPartial.professionalId,
      serviceId: catalogPartial.serviceId,
    });
    const { data, error } = await register(
      tenantPartial.tenantId,
      tenantPartial.admin.id,
      appointmentId,
      [{ method: "dinheiro", amount_cents: 4_000 }],
      randomUUID(),
      true,
    );
    expect(error).toBeNull();
    expect(data).toMatchObject({ payment_status: "parcial" });

    const summary = await summaryAs(tenantPartial.admin);
    expect(summary.error).toBeNull();
    expect(summary.data).toMatchObject({
      received_service_cents: 4_000,
      open_cents: 6_000,
    });
  });
});

describe("Pix do sistema após concluído e estorno", () => {
  let tenant: PaymentsTenant;
  let catalog: WalkInCatalog;
  let receptionist: TestUser;
  let appointmentId: string;
  let chargeId: string;
  let paymentId: string;

  beforeAll(async () => {
    tenant = await newTenant("pdv-pix");
    catalog = await seedWalkInCatalog(tenant.tenantId, { priceCents: 3_000 });
    await seedCommissionPct(tenant.tenantId, catalog.professionalId, 10);
    receptionist = await createTenantMember(tenant.tenantId, "receptionist", "pdv-pix-recep");

    appointmentId = await createWalkInOk({
      tenantId: tenant.tenantId,
      actorId: tenant.admin.id,
      professionalId: catalog.professionalId,
      serviceId: catalog.serviceId,
    });
    const registered = await register(
      tenant.tenantId,
      tenant.admin.id,
      appointmentId,
      [{ method: "pix_sistema", amount_cents: 3_000 }],
      randomUUID(),
      true,
    );
    expect(registered.error).toBeNull();
    expect(registered.data).toMatchObject({ pix_amount_cents: 3_000, appointment_status: "concluido" });
    expect(ledgerCount(tenant.tenantId, appointmentId)).toBe(0);
  });

  it("Pix após concluído cria 1 cobrança e o settle idempotente cria 1 linha", async () => {
    const reserved = await reserve(
      tenant.tenantId,
      tenant.admin.id,
      appointmentId,
      3_000,
      randomUUID(),
    );
    expect(reserved.error).toBeNull();
    chargeId = String((reserved.data as Record<string, unknown>).charge_id ?? "");
    expect(chargeId).not.toBe("");

    const first = await settle(tenant.tenantId, chargeId, `evt-${randomUUID()}`);
    expect(first.error).toBeNull();
    paymentId = String(((first.data as Record<string, unknown>).payment as Record<string, unknown>)?.id ?? "");
    expect(paymentId).not.toBe("");
    expect(ledgerCount(tenant.tenantId, appointmentId)).toBe(1);

    const replay = await settle(tenant.tenantId, chargeId, `evt-${randomUUID()}`);
    expect(replay.error).toBeNull();
    expect((replay.data as Record<string, unknown>).replayed).toBe(true);
    expect(ledgerCount(tenant.tenantId, appointmentId)).toBe(1);

    const summary = await summaryAs(tenant.admin);
    expect(summary.error).toBeNull();
    expect(summary.data).toMatchObject({ received_service_cents: 3_000, open_cents: 0 });
  });

  it("estorno é só admin; receita cai e a comissão não reverte", async () => {
    const denied = await voidPayment(tenant.tenantId, paymentId, receptionist.id, "tentativa");
    expect(denied.error?.code).toBe("PT403");

    const before = commissionCents(tenant.tenantId, appointmentId);
    expect(before).toBe(300);

    const voided = await voidPayment(tenant.tenantId, paymentId, tenant.admin.id, "estorno");
    expect(voided.error).toBeNull();
    expect(voided.data).toMatchObject({ voided: true, refund_required: true });

    const summary = await summaryAs(tenant.admin);
    expect(summary.error).toBeNull();
    expect(summary.data).toMatchObject({ received_service_cents: 0, open_cents: 3_000 });
    expect(commissionCents(tenant.tenantId, appointmentId)).toBe(before);
  });
});

describe("Idempotência e concorrência da criação", () => {
  let tenant: PaymentsTenant;
  let catalog: WalkInCatalog;

  beforeAll(async () => {
    tenant = await newTenant("pdv-idempotency");
    catalog = await seedWalkInCatalog(tenant.tenantId);
  });

  it("mesma creation_idempotency_key 2× cria 1 appointment", async () => {
    const key = randomUUID();
    const first = await callCreateWalkIn({
      tenantId: tenant.tenantId,
      actorId: tenant.admin.id,
      professionalId: catalog.professionalId,
      serviceId: catalog.serviceId,
      creationIdempotencyKey: key,
    });
    expect(first.error).toBeNull();
    expect(first.data?.reused).toBe(false);

    const replay = await callCreateWalkIn({
      tenantId: tenant.tenantId,
      actorId: tenant.admin.id,
      professionalId: catalog.professionalId,
      serviceId: catalog.serviceId,
      creationIdempotencyKey: key,
    });
    expect(replay.error).toBeNull();
    expect(replay.data?.reused).toBe(true);
    expect(replay.data?.id).toBe(first.data?.id);

    expect(
      Number(
        sql(
          `select count(*) from public.appointments
            where tenant_id = :'tenant'::uuid and creation_idempotency_key = :'key'::uuid;`,
          { tenant: tenant.tenantId, key },
        ),
      ),
    ).toBe(1);

    await moveWindow(tenant.tenantId, String(first.data?.id ?? ""), -180);
  });

  it("mesma idempotency_key de lote com assinatura divergente => PT409", async () => {
    const appointmentId = await createWalkInOk({
      tenantId: tenant.tenantId,
      actorId: tenant.admin.id,
      professionalId: catalog.professionalId,
      serviceId: catalog.serviceId,
    });
    const key = randomUUID();
    const first = await register(
      tenant.tenantId,
      tenant.admin.id,
      appointmentId,
      [{ method: "dinheiro", amount_cents: 4_000 }],
      key,
      true,
    );
    expect(first.error).toBeNull();

    const changed = await register(
      tenant.tenantId,
      tenant.admin.id,
      appointmentId,
      [{ method: "dinheiro", amount_cents: 5_000 }],
      key,
      true,
    );
    expect(changed.error?.code).toBe("PT409");
    expect(changed.error?.message).toBe("IDEMPOTENCY_CONFLICT");
    expect(ledgerCount(tenant.tenantId, appointmentId)).toBe(1);
  });

  it("2 vendas simultâneas do mesmo profissional => 1 sucesso + 1 conflito 23P01", async () => {
    const race = await seedWalkInCatalog(tenant.tenantId);
    const results = await Promise.all([
      callCreateWalkIn({
        tenantId: tenant.tenantId,
        actorId: tenant.admin.id,
        professionalId: race.professionalId,
        serviceId: race.serviceId,
        creationIdempotencyKey: randomUUID(),
      }),
      callCreateWalkIn({
        tenantId: tenant.tenantId,
        actorId: tenant.admin.id,
        professionalId: race.professionalId,
        serviceId: race.serviceId,
        creationIdempotencyKey: randomUUID(),
      }),
    ]);

    // Venda walk-in ABERTA (`em_atendimento`) disputa o horário do profissional
    // (migration 20261112090000_appointments_no_overlap_origin.sql): duas
    // vendas simultâneas seriam double-booking. Só a CONCLUÍDA sai do índice.
    const ok = results.filter((result) => result.error === null);
    const conflicts = results.filter((result) => result.error !== null);
    expect(ok).toHaveLength(1);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]?.error?.code).toBe("23P01");

    // O conflito atravessa o contrato HTTP como 409 SLOT_CONFLICT, nunca 500.
    const mapped = mapRpcError(conflicts[0]?.error ?? null);
    expect(mapped.status).toBe(409);
    expect(mapped.code).toBe("SLOT_CONFLICT");

    expect(appointmentCount(tenant.tenantId, race.professionalId)).toBe(1);
  });
});

describe("Venda consecutiva no PDV (walk-in não ocupa a agenda)", () => {
  let tenant: PaymentsTenant;
  let catalog: WalkInCatalog;

  beforeAll(async () => {
    tenant = await newTenant("pdv-consecutive");
    await setTenantSegment(tenant.tenantId, "barbearia");
    catalog = await seedWalkInCatalog(tenant.tenantId, { linkService: true });
  });

  it("2 vendas consecutivas do mesmo profissional dentro da duração => ambas 201 e pagamento 200", async () => {
    // Ordem do bug real: criar → pagar/concluir → criar → pagar/concluir, na
    // mesma janela do profissional. A venda concluída sai do índice de exclusão,
    // então a segunda criação não pode cair em 23P01/500.
    const first = await edgeWalkIn(tenant.admin, {
      professional_id: catalog.professionalId,
      service_id: catalog.serviceId,
      creation_idempotency_key: randomUUID(),
    });
    expect(first.status).toBe(201);
    const firstId = String(first.json?.appointment_id ?? "");
    expect(firstId).not.toBe("");

    const firstPaid = await callFunction("register-appointment-payments", {
      token: tenant.admin.accessToken,
      body: {
        appointment_id: firstId,
        idempotency_key: randomUUID(),
        close_appointment: true,
        payments: [{ method: "dinheiro", amount_cents: 10_000 }],
      },
    });
    expect(firstPaid.status).toBe(200);
    expect(await getAppointmentStatus(firstId)).toBe("concluido");

    const second = await edgeWalkIn(tenant.admin, {
      professional_id: catalog.professionalId,
      service_id: catalog.serviceId,
      creation_idempotency_key: randomUUID(),
    });
    expect(second.status).toBe(201);
    const secondId = String(second.json?.appointment_id ?? "");
    expect(secondId).not.toBe("");
    expect(secondId).not.toBe(firstId);

    const secondPaid = await callFunction("register-appointment-payments", {
      token: tenant.admin.accessToken,
      body: {
        appointment_id: secondId,
        idempotency_key: randomUUID(),
        close_appointment: true,
        payments: [{ method: "dinheiro", amount_cents: 10_000 }],
      },
    });
    expect(secondPaid.status).toBe(200);
    expect(await getAppointmentStatus(secondId)).toBe("concluido");

    expect(appointmentCount(tenant.tenantId, catalog.professionalId)).toBe(2);
  });
});

describe("Agendado continua protegido pela constraint de exclusão", () => {
  let tenant: PaymentsTenant;
  let catalog: WalkInCatalog;

  beforeAll(async () => {
    tenant = await newTenant("pdv-slot-guard");
    catalog = await seedWalkInCatalog(tenant.tenantId, { withCustomer: true });
  });

  function insertScheduled(startsAt: Date) {
    return serviceClient().from("appointments").insert({
      tenant_id: tenant.tenantId,
      origin: "agendado",
      customer_id: catalog.customerId,
      professional_id: catalog.professionalId,
      service_id: catalog.serviceId,
      starts_at: startsAt.toISOString(),
      ends_at: new Date(startsAt.getTime() + 30 * 60_000).toISOString(),
      price_cents: 10_000,
      status: "pendente",
    });
  }

  it("dois agendamentos sobrepostos do mesmo profissional => 23P01", async () => {
    const startsAt = new Date(Date.now() + 2 * 3_600_000);
    const first = await insertScheduled(startsAt);
    expect(first.error).toBeNull();

    // Mesma janela: a exclusão de agendamento continua ativa.
    const overlap = await insertScheduled(new Date(startsAt.getTime() + 5 * 60_000));
    expect(overlap.error?.code).toBe("23P01");
  });

  it("o erro real 23P01 do agendado vira 409 SLOT_CONFLICT, nunca 500", async () => {
    const startsAt = new Date(Date.now() + 4 * 3_600_000);
    const first = await insertScheduled(startsAt);
    expect(first.error).toBeNull();

    const overlap = await insertScheduled(new Date(startsAt.getTime() + 5 * 60_000));
    expect(overlap.error?.code).toBe("23P01");

    const mapped = mapRpcError(overlap.error);
    expect(mapped.status).toBe(409);
    expect(mapped.code).toBe("SLOT_CONFLICT");

    const response = errorResponse(mapped);
    expect(response.status).toBe(409);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.code).toBe("SLOT_CONFLICT");
  });
});

describe("Walk-in × agendado — dois sentidos e regressão do fix", () => {
  let tenant: PaymentsTenant;

  beforeAll(async () => {
    tenant = await newTenant("pdv-walk-in-slot-guard");
    await setTenantSegment(tenant.tenantId, "barbearia");
  });

  /** Agendamento do mesmo profissional cobrindo `[now-5min, now+25min)`. */
  function insertScheduled(catalog: WalkInCatalog) {
    const startsAt = new Date(Date.now() - 5 * 60_000);
    return serviceClient().from("appointments").insert({
      tenant_id: tenant.tenantId,
      origin: "agendado",
      customer_id: catalog.customerId,
      professional_id: catalog.professionalId,
      service_id: catalog.serviceId,
      starts_at: startsAt.toISOString(),
      ends_at: new Date(startsAt.getTime() + 30 * 60_000).toISOString(),
      price_cents: 10_000,
      status: "pendente",
    });
  }

  it("agendado ativo no horário bloqueia walk-in (23P01) e vira 409 SLOT_CONFLICT", async () => {
    const catalog = await seedWalkInCatalog(tenant.tenantId, {
      linkService: true,
      withCustomer: true,
    });
    const scheduled = await insertScheduled(catalog);
    expect(scheduled.error).toBeNull();

    // Banco: a venda aberta não pode se sobrepor a um agendamento existente.
    const rpc = await callCreateWalkIn({
      tenantId: tenant.tenantId,
      actorId: tenant.admin.id,
      professionalId: catalog.professionalId,
      serviceId: catalog.serviceId,
    });
    expect(rpc.error?.code).toBe("23P01");
    expect(mapRpcError(rpc.error).status).toBe(409);

    // Contrato: a Edge devolve 409 SLOT_CONFLICT com mensagem pt-BR, nunca 500.
    const edge = await edgeWalkIn(tenant.admin, {
      professional_id: catalog.professionalId,
      service_id: catalog.serviceId,
      creation_idempotency_key: randomUUID(),
    });
    expect(edge.status).toBe(409);
    expect(edge.json?.code).toBe("SLOT_CONFLICT");
    expect(String(edge.json?.message ?? "")).toMatch(/ocupado/i);

    expect(appointmentCount(tenant.tenantId, catalog.professionalId)).toBe(1);
  });

  it("walk-in aberto (em_atendimento) bloqueia agendamento sobreposto (23P01)", async () => {
    const catalog = await seedWalkInCatalog(tenant.tenantId, {
      linkService: true,
      withCustomer: true,
    });
    const walkInId = await createWalkInOk({
      tenantId: tenant.tenantId,
      actorId: tenant.admin.id,
      professionalId: catalog.professionalId,
      serviceId: catalog.serviceId,
    });

    const scheduled = await insertScheduled(catalog);
    expect(scheduled.error?.code).toBe("23P01");
    expect(await getAppointmentStatus(walkInId)).toBe("em_atendimento");
    expect(appointmentCount(tenant.tenantId, catalog.professionalId)).toBe(1);
  });

  it("walk-in concluído libera a janela: venda seguinte sucede (regressão do fix)", async () => {
    const catalog = await seedWalkInCatalog(tenant.tenantId, {
      linkService: true,
      withCustomer: true,
    });
    const firstId = await createWalkInOk({
      tenantId: tenant.tenantId,
      actorId: tenant.admin.id,
      professionalId: catalog.professionalId,
      serviceId: catalog.serviceId,
    });

    const concluded = await register(
      tenant.tenantId,
      tenant.admin.id,
      firstId,
      [{ method: "dinheiro", amount_cents: 10_000 }],
      randomUUID(),
      true,
    );
    expect(concluded.error).toBeNull();
    expect(await getAppointmentStatus(firstId)).toBe("concluido");

    // Mesmo profissional, dentro da duração da venda anterior: o concluído sai
    // do índice, então a segunda venda não colide (o bug reportado).
    const second = await callCreateWalkIn({
      tenantId: tenant.tenantId,
      actorId: tenant.admin.id,
      professionalId: catalog.professionalId,
      serviceId: catalog.serviceId,
      creationIdempotencyKey: randomUUID(),
    });
    expect(second.error).toBeNull();
    const secondId = String(second.data?.id ?? "");
    expect(secondId).not.toBe("");
    expect(secondId).not.toBe(firstId);
    expect(await getAppointmentStatus(secondId)).toBe("em_atendimento");
    expect(appointmentCount(tenant.tenantId, catalog.professionalId)).toBe(2);
  });
});

describe("RBAC do balcão", () => {
  let tenant: PaymentsTenant;
  let otherTenant: PaymentsTenant;
  let receptionist: TestUser;
  let professional: TestUser;
  let ownCatalog: WalkInCatalog;
  let otherCatalog: WalkInCatalog;

  beforeAll(async () => {
    tenant = await newTenant("pdv-rbac");
    otherTenant = await newTenant("pdv-rbac-other");
    await setTenantSegment(tenant.tenantId, "salao");
    receptionist = await createTenantMember(tenant.tenantId, "receptionist", "pdv-rbac-recep");
    professional = await createTenantMember(tenant.tenantId, "professional", "pdv-rbac-prof");
    ownCatalog = await seedWalkInCatalog(tenant.tenantId, {
      professionalProfileId: professional.id,
      linkService: true,
    });
    otherCatalog = await seedWalkInCatalog(tenant.tenantId, { linkService: true });
  });

  it("receptionist cria, vende e conclui, mas não lê financeiro", async () => {
    const created = await edgeWalkIn(receptionist, {
      professional_id: ownCatalog.professionalId,
      service_id: ownCatalog.serviceId,
      creation_idempotency_key: randomUUID(),
    });
    expect(created.status).toBe(201);
    const appointmentId = String(created.json?.appointment_id ?? "");
    expect(appointmentId).not.toBe("");

    const registered = await register(
      tenant.tenantId,
      receptionist.id,
      appointmentId,
      [{ method: "dinheiro", amount_cents: 10_000 }],
      randomUUID(),
      true,
    );
    expect(registered.error).toBeNull();
    expect(await getAppointmentStatus(appointmentId)).toBe("concluido");

    const summary = await summaryAs(receptionist);
    expect(summary.error?.code).toBe("PT403");

    const ledger = await receptionist.client.from("appointment_payments").select("id");
    expect(ledger.error).toBeNull();
    expect(ledger.data ?? []).toHaveLength(0);

    const commissions = await receptionist.client.from("appointment_commissions").select("id");
    expect(commissions.error).toBeNull();
    expect(commissions.data ?? []).toHaveLength(0);

    await moveWindow(tenant.tenantId, appointmentId, -180);
  });

  it("professional vende só para si (PROFESSIONAL_NOT_OWNER no alheio)", async () => {
    const own = await edgeWalkIn(professional, {
      professional_id: ownCatalog.professionalId,
      service_id: ownCatalog.serviceId,
      creation_idempotency_key: randomUUID(),
    });
    expect(own.status).toBe(201);

    const denied = await edgeWalkIn(professional, {
      professional_id: otherCatalog.professionalId,
      service_id: otherCatalog.serviceId,
      creation_idempotency_key: randomUUID(),
    });
    expect(denied.status).toBe(403);
    expect(denied.json?.code).toBe("PROFESSIONAL_NOT_OWNER");
  });

  it("admin vê tudo do tenant e nada cross-tenant", async () => {
    const own = await tenant.admin.client.from("appointments").select("id, tenant_id");
    expect(own.error).toBeNull();
    expect((own.data ?? []).length).toBeGreaterThan(0);
    for (const row of own.data ?? []) expect(row.tenant_id).toBe(tenant.tenantId);

    const cross = await tenant.admin.client
      .from("appointments")
      .select("id")
      .eq("tenant_id", otherTenant.tenantId);
    expect(cross.error).toBeNull();
    expect(cross.data ?? []).toHaveLength(0);

    const summary = await summaryAs(tenant.admin);
    expect(summary.error).toBeNull();
    expect(Number((summary.data as Record<string, number>).received_service_cents)).toBe(10_000);
  });
});

describe("Gate de segmento da Edge create-walk-in", () => {
  let tenantClinica: PaymentsTenant;
  let catalogClinica: WalkInCatalog;
  let tenantNoSegment: PaymentsTenant;
  let catalogNoSegment: WalkInCatalog;

  beforeAll(async () => {
    tenantClinica = await newTenant("pdv-segment-clinica");
    await setTenantSegment(tenantClinica.tenantId, "clinica");
    catalogClinica = await seedWalkInCatalog(tenantClinica.tenantId);
    tenantNoSegment = await newTenant("pdv-segment-none");
    catalogNoSegment = await seedWalkInCatalog(tenantNoSegment.tenantId);
  });

  it("clínica e tenant sem ramo recebem SEGMENT_NOT_ENABLED sem escrita", async () => {
    const clinica = await edgeWalkIn(tenantClinica.admin, {
      professional_id: catalogClinica.professionalId,
      service_id: catalogClinica.serviceId,
      creation_idempotency_key: randomUUID(),
    });
    expect(clinica.status).toBe(409);
    expect(clinica.json?.code).toBe("SEGMENT_NOT_ENABLED");
    expect(appointmentCount(tenantClinica.tenantId)).toBe(0);

    const none = await edgeWalkIn(tenantNoSegment.admin, {
      professional_id: catalogNoSegment.professionalId,
      service_id: catalogNoSegment.serviceId,
      creation_idempotency_key: randomUUID(),
    });
    expect(none.status).toBe(409);
    expect(none.json?.code).toBe("SEGMENT_NOT_ENABLED");
    expect(appointmentCount(tenantNoSegment.tenantId)).toBe(0);
  });
});
