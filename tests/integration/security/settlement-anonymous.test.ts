// Regressão do bug pdv-checkout-anonimo: abrir o settlement de um atendimento
// sem cliente (walk-in anônimo) ou por combo (`service_id` nulo) devolvia
// 500 INTERNAL porque `loadSettlement` montava `.eq("id", null)` e o PostgREST
// respondia 22P02. Agora os dois caminhos precisam responder 200.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { serviceClient } from "../helpers/clients.ts";
import { callFunction } from "../helpers/functions.ts";
import {
  callCreateWalkIn,
  cleanupPaymentFixtures,
  createPaymentsTenant,
  seedWalkInCatalog,
  setTenantSegment,
  type PaymentsTenant,
  type WalkInCatalog,
} from "../helpers/payments-fixtures.ts";
import { deleteTestUsers } from "../helpers/users.ts";

const tenantsToCleanup: string[] = [];

async function newTenant(prefix: string): Promise<PaymentsTenant> {
  const tenant = await createPaymentsTenant(prefix);
  tenantsToCleanup.push(tenant.tenantId);
  await setTenantSegment(tenant.tenantId, "salao");
  return tenant;
}

function settlementOf(tenant: PaymentsTenant, appointmentId: string) {
  return callFunction("get-appointment-settlement", {
    token: tenant.admin.accessToken,
    body: { appointment_id: appointmentId },
  });
}

async function createCombo(
  tenantId: string,
  serviceId: string,
  priceCents: number,
): Promise<string> {
  const admin = serviceClient();
  const combo = await admin
    .from("combos")
    .insert({
      tenant_id: tenantId,
      name: `Combo ${randomUUID().slice(0, 8)}`,
      price_cents: priceCents,
    })
    .select("id")
    .single();
  if (combo.error || !combo.data) {
    throw new Error(`Fixture combo falhou (código ${combo.error?.code ?? "vazio"}).`);
  }
  const link = await admin.from("combo_services").insert({
    tenant_id: tenantId,
    combo_id: combo.data.id,
    service_id: serviceId,
  });
  if (link.error) {
    throw new Error(`Fixture combo_services falhou (código ${link.error.code ?? "vazio"}).`);
  }
  return combo.data.id as string;
}

function createWalkInWithCombo(params: {
  tenantId: string;
  actorId: string;
  professionalId: string;
  comboId: string;
  customerId?: string | null;
}) {
  return serviceClient().rpc("create_walk_in_appointment", {
    p_tenant_id: params.tenantId,
    p_actor_id: params.actorId,
    p_professional_id: params.professionalId,
    p_service_id: null,
    p_combo_id: params.comboId,
    p_customer_id: params.customerId ?? null,
    p_creation_idempotency_key: randomUUID(),
  });
}

afterAll(async () => {
  await cleanupPaymentFixtures(tenantsToCleanup);
  await deleteTestUsers();
});

describe("get-appointment-settlement de walk-in sem cliente e de combo", () => {
  let tenant: PaymentsTenant;
  let catalog: WalkInCatalog;
  let withCustomer: WalkInCatalog;

  beforeAll(async () => {
    tenant = await newTenant("settlement-anon");
    catalog = await seedWalkInCatalog(tenant.tenantId);
    withCustomer = await seedWalkInCatalog(tenant.tenantId, { withCustomer: true });
  });

  it("walk-in anônimo (customer_id null) responde 200 com customer_name null", async () => {
    const created = await callCreateWalkIn({
      tenantId: tenant.tenantId,
      actorId: tenant.admin.id,
      professionalId: catalog.professionalId,
      serviceId: catalog.serviceId,
    });
    expect(created.error).toBeNull();
    const appointmentId = String(created.data?.id ?? "");
    expect(appointmentId).not.toBe("");

    const response = await settlementOf(tenant, appointmentId);
    expect(response.status).toBe(200);
    const body = response.json as Record<string, any>;
    expect(body.appointment.customer_name).toBeNull();
    expect(String(body.appointment.service_name)).toContain("Serviço balcão");
    expect(body.payment_status).toBe("sem_pagamento");
  });

  it("venda por combo (service_id null) responde 200 com service_name null", async () => {
    const comboId = await createCombo(tenant.tenantId, withCustomer.serviceId, 12_000);
    const created = await createWalkInWithCombo({
      tenantId: tenant.tenantId,
      actorId: tenant.admin.id,
      professionalId: withCustomer.professionalId,
      comboId,
      customerId: withCustomer.customerId,
    });
    expect(created.error).toBeNull();
    const appointmentId = String((created.data as Record<string, unknown> | null)?.id ?? "");
    expect(appointmentId).not.toBe("");

    const response = await settlementOf(tenant, appointmentId);
    expect(response.status).toBe(200);
    const body = response.json as Record<string, any>;
    expect(String(body.appointment.customer_name)).toContain("Cliente balcão");
    expect(body.appointment.service_name).toBeNull();
  });
});
