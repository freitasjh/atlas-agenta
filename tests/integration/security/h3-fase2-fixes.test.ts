// Regressão H3 Fase 2 via PostgREST real (v1.4 RF-01 + RF-12) — vitest integração.
// Prova no nível do REST (sessões JWT reais), fiel ao caminho da UI:
//   RF-01: admin insere ficha/evolução em atendimento pendente sem tenant_id
//     no body (defaults do banco); recepção recebe 42501.
//   RF-12: concluir atendimento sem vínculo com crédito ativo baixa 1 no mesmo
//     commit e grava o vínculo; cancelado não consome.
// PostgreSQL real, nunca mock/H2. Limpeza pelos helpers existentes.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { serviceClient } from "../helpers/clients.ts";
import { sql } from "../helpers/sql.ts";
import {
  createCommonUser,
  createTenantMember,
  deleteTestUsers,
  tenantIdOf,
  type TestUser,
} from "../helpers/users.ts";

const DAY = 86_400_000;

function slot(daysAhead: number, hourUtc: number): { start: string; end: string } {
  const start = new Date(Date.now() + daysAhead * DAY);
  start.setUTCHours(hourUtc, 0, 0, 0);
  const end = new Date(start.getTime() + 60 * 60 * 1000);
  return { start: start.toISOString(), end: end.toISOString() };
}

describe("H3 Fase 2 fixes (v1.4 RF-01 + RF-12)", () => {
  let admin: TestUser;
  let recep: TestUser;
  let tenantId: string;
  let serviceId: string;
  let professionalId: string;
  let customerId: string;

  beforeAll(async () => {
    admin = await createCommonUser("h3ficha");
    tenantId = await tenantIdOf(admin.id);
    recep = await createTenantMember(tenantId, "receptionist", "h3ficha-recep");

    const db = serviceClient();
    const { data: service, error: serviceError } = await db
      .from("services")
      .insert({ tenant_id: tenantId, name: "Limpeza H3", duration_minutes: 60, price_cents: 15000, active: true })
      .select("id")
      .single();
    if (serviceError || !service) throw new Error(`Fixture service falhou (${serviceError?.code ?? "sem código"}).`);
    serviceId = service.id;

    const { data: professional, error: professionalError } = await db
      .from("professionals")
      .insert({ tenant_id: tenantId, name: "Prof H3", profile_id: admin.id, active: true })
      .select("id")
      .single();
    if (professionalError || !professional) {
      throw new Error(`Fixture professional falhou (${professionalError?.code ?? "sem código"}).`);
    }
    professionalId = professional.id;

    const { data: customer, error: customerError } = await db
      .from("customers")
      .insert({ tenant_id: tenantId, name: "Cliente H3", phone: "+5511900000099", active: true })
      .select("id")
      .single();
    if (customerError || !customer) throw new Error(`Fixture customer falhou (${customerError?.code ?? "sem código"}).`);
    customerId = customer.id;
  }, 120_000);

  afterAll(async () => {
    // `clinical_records` é append-only até para o owner (trigger ENABLE ALWAYS;
    // grants revogados da service role): o único bypass é DDL, em transação
    // única — falha no meio dá rollback e os triggers continuam armados
    // (conferido abaixo). Ordem respeita os FKs restrict.
    sql(
      `begin;
       alter table public.clinical_records disable trigger clinical_records_block_update_delete;
       delete from public.clinical_records where tenant_id = :'tenant'::uuid;
       alter table public.clinical_records enable always trigger clinical_records_block_update_delete;
       commit;`,
      { tenant: tenantId },
    );
    const armed = sql(
      `select count(*) from pg_trigger where tgrelid = 'public.clinical_records'::regclass and tgenabled = 'A';`,
    );
    expect(armed).toBe("2");

    const db = serviceClient();
    for (const table of ["appointments", "package_credits", "services", "professionals", "customers"] as const) {
      const { error } = await db.from(table).delete().eq("tenant_id", tenantId);
      if (error) throw new Error(`Limpeza de ${table} falhou (código ${error.code ?? "sem código"}).`);
    }
    await deleteTestUsers();
  });

  async function createAppointment(daysAhead: number, hourUtc: number): Promise<string> {
    const { start, end } = slot(daysAhead, hourUtc);
    const { data, error } = await admin.client
      .from("appointments")
      .insert({
        customer_id: customerId,
        professional_id: professionalId,
        service_id: serviceId,
        starts_at: start,
        ends_at: end,
        price_cents: 15000,
      })
      .select("id")
      .single();
    if (error || !data) throw new Error(`Agendamento H3 falhou (${error?.code ?? "sem código"}).`);
    return data.id as string;
  }

  it("RF-01: admin insere ficha em atendimento pendente sem tenant_id (201)", async () => {
    const appointmentId = await createAppointment(30, 13);
    const { data, error } = await admin.client
      .from("clinical_records")
      .insert({ appointment_id: appointmentId, customer_id: customerId, clinical_notes: "Anamnese H3 REST" })
      .select("id, tenant_id, created_by")
      .single();
    expect(error).toBeNull();
    expect(data?.tenant_id).toBe(tenantId);
    expect(data?.created_by).toBe(admin.id);
  });

  it("RF-01: recepção não insere ficha (42501)", async () => {
    const appointmentId = await createAppointment(31, 13);
    const { error } = await recep.client
      .from("clinical_records")
      .insert({ appointment_id: appointmentId, customer_id: customerId, clinical_notes: "Recepção H3" });
    expect(error?.code).toBe("42501");
  });

  it("RF-12: concluir sem vínculo baixa 1 e grava o vínculo", async () => {
    const { data: creditId, error: sellError } = await admin.client.rpc("sell_package", {
      p_customer_id: customerId,
      p_service_id: serviceId,
      p_total_sessions: 5,
      p_price_cents: 60000,
      p_validity_days: 30,
    });
    expect(sellError).toBeNull();

    const appointmentId = await createAppointment(32, 13);
    const { error: e1 } = await admin.client.from("appointments").update({ status: "em_atendimento" }).eq("id", appointmentId);
    expect(e1).toBeNull();
    const { error: e2 } = await admin.client.from("appointments").update({ status: "concluido" }).eq("id", appointmentId);
    expect(e2).toBeNull();

    const db = serviceClient();
    const { data: credit } = await db.from("package_credits").select("used_sessions").eq("id", creditId as string).single();
    expect(credit?.used_sessions).toBe(1);
    const { data: appt } = await db.from("appointments").select("package_credit_id").eq("id", appointmentId).single();
    expect(appt?.package_credit_id).toBe(creditId);
  });

  it("RF-12: cancelado com crédito ativo não consome nem vincula", async () => {
    const db = serviceClient();
    const { data: before } = await db.from("package_credits").select("used_sessions").eq("tenant_id", tenantId);
    const usedBefore = (before ?? []).reduce((sum, credit) => sum + (credit.used_sessions ?? 0), 0);

    const appointmentId = await createAppointment(33, 13);
    const { error } = await admin.client.from("appointments").update({ status: "cancelado" }).eq("id", appointmentId);
    expect(error).toBeNull();

    const { data: appt } = await db.from("appointments").select("package_credit_id").eq("id", appointmentId).single();
    expect(appt?.package_credit_id).toBeNull();
    const { data: after } = await db.from("package_credits").select("used_sessions").eq("tenant_id", tenantId);
    const usedAfter = (after ?? []).reduce((sum, credit) => sum + (credit.used_sessions ?? 0), 0);
    expect(usedAfter).toBe(usedBefore);
  });
});
