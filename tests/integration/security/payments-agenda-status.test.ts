// Status financeiro em lote por atendimento (adendo ADR-002, 2026-11-06; RF-06/RF-07/RF-08/RF-20).
// Cobre paridade com o summary, recorte por tenant/vínculo, limites do lote e ausência de valores.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { serviceClient } from "../helpers/clients.ts";
import { callFunction } from "../helpers/functions.ts";
import {
  cleanupPaymentFixtures,
  createPaymentsTenant,
  readSummary,
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
let otherProfessional: TestUser;
let inactive: TestUser;

const EDGE = "get-agenda-payment-statuses";

interface StatusRow {
  appointment_id: string;
  payment_status: string;
}

function statusesOf(response: { json: Record<string, unknown> | null }): StatusRow[] {
  return ((response.json?.statuses ?? []) as StatusRow[]).slice();
}

function statusMap(rows: readonly StatusRow[]): Map<string, string> {
  return new Map(rows.map((row) => [row.appointment_id, row.payment_status]));
}

/** Chama a Edge como o ator informado, com `ids` no corpo estrito. */
async function callEdge(token: string | undefined, ids: readonly string[]) {
  return callFunction(EDGE, {
    token,
    body: { appointment_ids: [...ids] },
  });
}

function rpcStatuses(
  tenantId: string,
  ids: readonly string[],
  professionalId?: string | null,
  actorId?: string | null,
) {
  return serviceClient().rpc("agenda_payment_statuses", {
    p_tenant_id: tenantId,
    p_appointment_ids: [...ids],
    p_professional_id: professionalId ?? null,
    p_actor_id: actorId ?? null,
  });
}

beforeAll(async () => {
  tenantA = await createPaymentsTenant("agenda-status-a");
  tenantB = await createPaymentsTenant("agenda-status-b");
  receptionist = await createTenantMember(tenantA.tenantId, "receptionist", "agenda-status-recep");
  professional = await createTenantMember(tenantA.tenantId, "professional", "agenda-status-prof");
  otherProfessional = await createTenantMember(
    tenantA.tenantId,
    "professional",
    "agenda-status-prof-2",
  );
  inactive = await createTenantMember(tenantA.tenantId, "receptionist", "agenda-status-inactive");
  await serviceClient().from("profiles").update({ active: false }).eq("id", inactive.id);
});

afterAll(async () => {
  await cleanupPaymentFixtures([tenantA.tenantId, tenantB.tenantId]);
  await deleteTestUsers();
});

describe("RF-20 catálogo, security invoker e grants", () => {
  it("a função existe com a assinatura congelada e dois argumentos opcionais", () => {
    const found = sql(
      `select p.pronargs || ':' || p.pronargdefaults
         from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.oid = 'public.agenda_payment_statuses(uuid, uuid[], uuid, uuid)'::regprocedure;`,
    );
    expect(found).toBe("4:2");
  });

  it("o overload antigo de 3 argumentos não existe", () => {
    const count = sql(
      `select count(*)
         from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.proname = 'agenda_payment_statuses';`,
    );
    expect(count).toBe("1");
    const missing = sql(
      `select count(*)
         from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.proname = 'agenda_payment_statuses'
          and p.pronargs = 3;`,
    );
    expect(missing).toBe("0");
  });

  it("security invoker, search_path fixo e execute só para service_role", () => {
    const row = sql(
      `select p.prosecdef || ':' || coalesce(array_to_string(p.proconfig, ','), '') || ':'
              || has_function_privilege('anon', p.oid, 'execute') || ':'
              || has_function_privilege('authenticated', p.oid, 'execute') || ':'
              || has_function_privilege('service_role', p.oid, 'execute')
         from pg_proc p
        where p.oid = 'public.agenda_payment_statuses(uuid, uuid[], uuid, uuid)'::regprocedure;`,
    );
    expect(row).toBe("false:search_path=public, pg_temp:false:false:true");
  });

  it("lote acima de 200 é recusado pela própria função (PT400 INVALID_BODY)", async () => {
    const ids = Array.from({ length: 201 }, () => randomUUID());
    const { error } = await rpcStatuses(tenantA.tenantId, ids);
    expect(error?.code).toBe("PT400");
    expect(error?.message).toBe("INVALID_BODY");
  });
});

describe("RF-06/paridade status financeiro por atendimento", () => {
  let zero: AppointmentFixture;
  let paid: AppointmentFixture;
  let awaitingPix: AppointmentFixture;
  let unpaid: AppointmentFixture;
  let partial: AppointmentFixture;

  beforeAll(async () => {
    zero = await seedAppointment(tenantA.tenantId, { status: "concluido", priceCents: 0 });

    paid = await seedAppointment(tenantA.tenantId, { status: "concluido", priceCents: 10_000 });
    await seedPayment({
      tenantId: tenantA.tenantId,
      appointmentId: paid.appointmentId,
      amountCents: 10_000,
    });

    awaitingPix = await seedAppointment(tenantA.tenantId, {
      status: "concluido",
      priceCents: 10_000,
    });
    await seedPayment({
      tenantId: tenantA.tenantId,
      appointmentId: awaitingPix.appointmentId,
      amountCents: 3_000,
    });
    await seedCharge({
      tenantId: tenantA.tenantId,
      appointmentId: awaitingPix.appointmentId,
      amountCents: 2_000,
      status: "pendente",
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    });

    unpaid = await seedAppointment(tenantA.tenantId, { status: "concluido", priceCents: 10_000 });

    partial = await seedAppointment(tenantA.tenantId, { status: "concluido", priceCents: 10_000 });
    await seedPayment({
      tenantId: tenantA.tenantId,
      appointmentId: partial.appointmentId,
      amountCents: 4_000,
    });
  });

  it("devolve exatamente os 4 rótulos com a precedência do summary", async () => {
    const response = await callEdge(tenantA.admin.accessToken, [
      zero.appointmentId,
      paid.appointmentId,
      awaitingPix.appointmentId,
      unpaid.appointmentId,
      partial.appointmentId,
    ]);

    expect(response.status).toBe(200);
    const map = statusMap(statusesOf(response));
    expect(map.get(zero.appointmentId)).toBe("quitado");
    expect(map.get(paid.appointmentId)).toBe("quitado");
    expect(map.get(awaitingPix.appointmentId)).toBe("aguardando_pix");
    expect(map.get(unpaid.appointmentId)).toBe("sem_pagamento");
    expect(map.get(partial.appointmentId)).toBe("parcial");

    for (const id of [
      zero.appointmentId,
      paid.appointmentId,
      awaitingPix.appointmentId,
      unpaid.appointmentId,
      partial.appointmentId,
    ]) {
      const summary = await readSummary(tenantA.tenantId, id);
      expect(map.get(id)).toBe(summary?.payment_status);
    }
  });

  it("resposta só tem appointment_id/payment_status — nenhum valor ou QR", async () => {
    const response = await callEdge(tenantA.admin.accessToken, [
      paid.appointmentId,
      awaitingPix.appointmentId,
    ]);
    expect(response.status).toBe(200);
    for (const row of statusesOf(response)) {
      expect(Object.keys(row).sort()).toEqual(["appointment_id", "payment_status"]);
    }
    expect(response.text).not.toMatch(
      /amount_cents|price_cents|remaining_cents|total_paid_cents|tip_cents|pix_qr_code|pix_copy_paste|saldo/i,
    );
  });

  it("ids inexistentes ficam fora da resposta; duplicados não repetem", async () => {
    const missing = randomUUID();
    const response = await callEdge(tenantA.admin.accessToken, [
      partial.appointmentId,
      missing,
      partial.appointmentId,
    ]);
    expect(response.status).toBe(200);
    expect(statusesOf(response)).toEqual([
      { appointment_id: partial.appointmentId, payment_status: "parcial" },
    ]);
  });
});

describe("RF-07/RF-08 recorte por tenant e por vínculo", () => {
  let own: AppointmentFixture;
  let foreign: AppointmentFixture;

  beforeAll(async () => {
    own = await seedAppointment(tenantA.tenantId, {
      status: "concluido",
      priceCents: 5_000,
      professionalProfileId: professional.id,
    });
    await seedPayment({
      tenantId: tenantA.tenantId,
      appointmentId: own.appointmentId,
      amountCents: 5_000,
    });
    foreign = await seedAppointment(tenantA.tenantId, {
      status: "concluido",
      priceCents: 5_000,
      professionalProfileId: otherProfessional.id,
    });
  });

  it("admin e recepção veem o tenant inteiro", async () => {
    const asAdmin = await callEdge(tenantA.admin.accessToken, [
      own.appointmentId,
      foreign.appointmentId,
    ]);
    expect(asAdmin.status).toBe(200);
    expect(statusMap(statusesOf(asAdmin)).size).toBe(2);

    const asReception = await callEdge(receptionist.accessToken, [
      own.appointmentId,
      foreign.appointmentId,
    ]);
    expect(asReception.status).toBe(200);
    expect(statusMap(statusesOf(asReception)).size).toBe(2);
  });

  it("profissional vê o próprio atendimento", async () => {
    const response = await callEdge(professional.accessToken, [own.appointmentId]);
    expect(response.status).toBe(200);
    expect(statusMap(statusesOf(response)).get(own.appointmentId)).toBe("quitado");
  });

  it("profissional em atendimento alheio => 200 vazio, igual a id inexistente", async () => {
    const foreignResponse = await callEdge(professional.accessToken, [foreign.appointmentId]);
    const missingResponse = await callEdge(professional.accessToken, [randomUUID()]);

    expect(foreignResponse.status).toBe(200);
    expect(statusesOf(foreignResponse)).toEqual([]);
    expect({ status: foreignResponse.status, json: foreignResponse.json }).toEqual({
      status: missingResponse.status,
      json: missingResponse.json,
    });
  });

  it("profissional com próprio + alheio => 200 e só o próprio", async () => {
    const response = await callEdge(professional.accessToken, [
      own.appointmentId,
      foreign.appointmentId,
    ]);
    expect(response.status).toBe(200);
    expect(statusesOf(response)).toEqual([
      { appointment_id: own.appointmentId, payment_status: "quitado" },
    ]);
  });

  it("lote de 200 UUIDs distintos: admin e profissional respondem 200", async () => {
    const ids = Array.from({ length: 200 }, () => randomUUID());
    expect(new Set(ids).size).toBe(200);

    const asAdmin = await callEdge(tenantA.admin.accessToken, ids);
    expect(asAdmin.status).toBe(200);
    expect(statusesOf(asAdmin)).toEqual([]);

    const asProfessional = await callEdge(professional.accessToken, ids);
    expect(asProfessional.status).toBe(200);
    expect(statusesOf(asProfessional)).toEqual([]);

    const withOwn = [...ids.slice(0, 199), own.appointmentId];
    const mixed = await callEdge(professional.accessToken, withOwn);
    expect(mixed.status).toBe(200);
    expect(statusesOf(mixed)).toEqual([
      { appointment_id: own.appointmentId, payment_status: "quitado" },
    ]);
  });

  it("tenant B não enxerga atendimento do tenant A", async () => {
    const asAdminB = await callEdge(tenantB.admin.accessToken, [own.appointmentId]);
    expect(asAdminB.status).toBe(200);
    expect(statusesOf(asAdminB)).toEqual([]);

    const { data } = await rpcStatuses(tenantB.tenantId, [own.appointmentId]);
    expect(data).toEqual([]);
  });

  it("a função filtra pelo profissional quando o id é informado", async () => {
    const { data, error } = await rpcStatuses(
      tenantA.tenantId,
      [own.appointmentId, foreign.appointmentId],
      own.professionalId,
      professional.id,
    );
    expect(error).toBeNull();
    expect(data).toEqual([{ appointment_id: own.appointmentId, payment_status: "quitado" }]);
  });

  it("recorte por profissional sem dono comprovado devolve vazio, nunca erro", async () => {
    const wrongActor = await rpcStatuses(
      tenantA.tenantId,
      [own.appointmentId],
      own.professionalId,
      otherProfessional.id,
    );
    expect(wrongActor.error).toBeNull();
    expect(wrongActor.data).toEqual([]);

    const wrongProfessional = await rpcStatuses(
      tenantA.tenantId,
      [foreign.appointmentId],
      foreign.professionalId,
      professional.id,
    );
    expect(wrongProfessional.error).toBeNull();
    expect(wrongProfessional.data).toEqual([]);

    const noActor = await rpcStatuses(tenantA.tenantId, [own.appointmentId], own.professionalId);
    expect(noActor.error).toBeNull();
    expect(noActor.data).toEqual([]);

    const control = await rpcStatuses(
      tenantA.tenantId,
      [own.appointmentId],
      own.professionalId,
      professional.id,
    );
    expect(control.error).toBeNull();
    expect(control.data).toEqual([
      { appointment_id: own.appointmentId, payment_status: "quitado" },
    ]);
  });

  it("usuário inativo => 403 FORBIDDEN", async () => {
    const response = await callEdge(inactive.accessToken, [own.appointmentId]);
    expect(response.status).toBe(403);
    expect(response.json?.code).toBe("FORBIDDEN");
  });
});

describe("RF-13 corpo estrito, autenticação e limite do lote", () => {
  let fixture: AppointmentFixture;

  beforeAll(async () => {
    fixture = await seedAppointment(tenantA.tenantId, { status: "concluido", priceCents: 1_000 });
  });

  it("sem JWT => 401 UNAUTHENTICATED", async () => {
    const response = await callEdge(undefined, [fixture.appointmentId]);
    expect(response.status).toBe(401);
    expect(response.json?.code).toBe("UNAUTHENTICATED");
  });

  it("tenant_id/role no corpo => 400 INVALID_BODY", async () => {
    for (const extra of [{ tenant_id: tenantA.tenantId }, { role: "admin" }]) {
      const response = await callFunction(EDGE, {
        token: tenantA.admin.accessToken,
        body: { appointment_ids: [fixture.appointmentId], ...extra },
      });
      expect(response.status).toBe(400);
      expect(response.json?.code).toBe("INVALID_BODY");
    }
  });

  it("corpo vazio, lote vazio e id não-uuid => 400 INVALID_BODY", async () => {
    for (const body of [{}, { appointment_ids: [] }, { appointment_ids: ["x"] }]) {
      const response = await callFunction(EDGE, { token: tenantA.admin.accessToken, body });
      expect(response.status).toBe(400);
      expect(response.json?.code).toBe("INVALID_BODY");
    }
  });

  it("lote de 201 ids distintos => 400 INVALID_BODY", async () => {
    const ids = Array.from({ length: 201 }, () => randomUUID());
    expect(new Set(ids).size).toBe(201);
    const response = await callEdge(tenantA.admin.accessToken, ids);
    expect(response.status).toBe(400);
    expect(response.json?.code).toBe("INVALID_BODY");
  });

  it("lote de 200 UUIDs distintos é aceito", async () => {
    const ids = Array.from({ length: 200 }, () => randomUUID());
    expect(new Set(ids).size).toBe(200);
    const response = await callEdge(tenantA.admin.accessToken, ids);
    expect(response.status).toBe(200);
    expect(statusesOf(response)).toEqual([]);
  });

  it("método diferente de POST => 405", async () => {
    const response = await callFunction(EDGE, {
      method: "GET",
      token: tenantA.admin.accessToken,
    });
    expect(response.status).toBe(405);
  });
});
