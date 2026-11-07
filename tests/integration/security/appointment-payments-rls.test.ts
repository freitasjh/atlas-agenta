// RLS/RBAC do ledger de recebimento (ADR-001; RF-07, RF-08; I8). O `sql()` roda como owner e
// bypassa RLS, então o recorte por tenant e a negação de escrita são provados com sessões
// autenticadas reais (JWT emitido pelo GoTrue local).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { serviceClient } from "../helpers/clients.ts";
import {
  cleanupPaymentFixtures,
  createPaymentsTenant,
  seedAppointment,
  seedCharge,
  type AppointmentFixture,
  type PaymentsTenant,
} from "../helpers/payments-fixtures.ts";
import { sql } from "../helpers/sql.ts";
import {
  createSuperAdminUser,
  createTenantMember,
  deleteTestUsers,
  type TestUser,
} from "../helpers/users.ts";

let tenantA: PaymentsTenant;
let tenantB: PaymentsTenant;
let fixtureA: AppointmentFixture;
let receptionist: TestUser;
let professional: TestUser;
let superAdmin: TestUser;
let ledgerIdA: string;
let chargeIdA: string;

function count(query: string): number {
  return Number(sql(query));
}

async function seedLedger(tenantId: string, appointmentId: string, amountCents: number): Promise<string> {
  const { data, error } = await serviceClient()
    .from("appointment_payments")
    .insert({
      tenant_id: tenantId,
      appointment_id: appointmentId,
      method: "dinheiro",
      amount_cents: amountCents,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`Seed do ledger falhou (código ${error?.code ?? "vazio"}).`);
  return data.id;
}

beforeAll(async () => {
  tenantA = await createPaymentsTenant("payments-rls-a");
  tenantB = await createPaymentsTenant("payments-rls-b");
  fixtureA = await seedAppointment(tenantA.tenantId);
  const fixtureB = await seedAppointment(tenantB.tenantId);

  receptionist = await createTenantMember(tenantA.tenantId, "receptionist", "payments-rls-reception");
  professional = await createTenantMember(tenantA.tenantId, "professional", "payments-rls-professional");
  superAdmin = await createSuperAdminUser("payments-rls-super");

  ledgerIdA = await seedLedger(tenantA.tenantId, fixtureA.appointmentId, 4_000);
  await seedLedger(tenantA.tenantId, fixtureA.appointmentId, 1_500);
  await seedLedger(tenantB.tenantId, fixtureB.appointmentId, 9_900);
  chargeIdA = await seedCharge({ tenantId: tenantA.tenantId, appointmentId: fixtureA.appointmentId });
});

afterAll(async () => {
  await cleanupPaymentFixtures([tenantA.tenantId, tenantB.tenantId]);
  await deleteTestUsers();
});

describe("RF-07 grants da tabela", () => {
  it("authenticated tem só SELECT; anon não tem nada; service_role tem tudo", () => {
    expect(sql("select has_table_privilege('authenticated','public.appointment_payments','SELECT');")).toBe("t");
    for (const privilege of ["INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER"]) {
      expect(
        sql(`select has_table_privilege('authenticated','public.appointment_payments','${privilege}');`),
        `authenticated ${privilege}`,
      ).toBe("f");
    }
    for (const privilege of ["SELECT", "INSERT", "UPDATE", "DELETE"]) {
      expect(
        sql(`select has_table_privilege('anon','public.appointment_payments','${privilege}');`),
        `anon ${privilege}`,
      ).toBe("f");
    }
    for (const privilege of ["SELECT", "INSERT", "UPDATE", "DELETE"]) {
      expect(
        sql(`select has_table_privilege('service_role','public.appointment_payments','${privilege}');`),
        `service_role ${privilege}`,
      ).toBe("t");
    }
  });

  it("RLS habilitado e exatamente uma policy, de select", () => {
    expect(
      count(
        `select count(*) from pg_class c
           join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'public' and c.relname = 'appointment_payments' and c.relrowsecurity;`,
      ),
    ).toBe(1);
    const policies = sql(
      `select string_agg(policyname || ':' || cmd, ',' order by policyname)
         from pg_policies
        where schemaname = 'public' and tablename = 'appointment_payments';`,
    );
    expect(policies).toBe("appointment_payments_select_tenant_admin:SELECT");
  });
});

describe("RF-07 admin lê só o próprio tenant", () => {
  it("admin A vê as duas linhas de A e nenhuma de B", async () => {
    const { data, error } = await tenantA.admin.client
      .from("appointment_payments")
      .select("id, tenant_id");
    expect(error).toBeNull();
    expect(data ?? []).toHaveLength(2);
    for (const row of data ?? []) expect(row.tenant_id).toBe(tenantA.tenantId);
  });

  it("admin B vê só a linha de B", async () => {
    const { data, error } = await tenantB.admin.client
      .from("appointment_payments")
      .select("id, tenant_id");
    expect(error).toBeNull();
    expect(data ?? []).toHaveLength(1);
    expect(data?.[0]?.tenant_id).toBe(tenantB.tenantId);
  });

  it("insert, update e delete falham com 42501 para admin, receptionist e professional", async () => {
    const authenticatedUsers = [
      { label: "admin", user: tenantA.admin },
      { label: "receptionist", user: receptionist },
      { label: "professional", user: professional },
    ];

    for (const { label, user } of authenticatedUsers) {
      const insert = await user.client.from("appointment_payments").insert({
        tenant_id: tenantA.tenantId,
        appointment_id: fixtureA.appointmentId,
        method: "dinheiro",
        amount_cents: 700,
      });
      expect(insert.error?.code, `${label} insert`).toBe("42501");

      const update = await user.client
        .from("appointment_payments")
        .update({ amount_cents: 1 })
        .eq("id", ledgerIdA)
        .select("id");
      expect(update.error?.code, `${label} update`).toBe("42501");

      const remove = await user.client
        .from("appointment_payments")
        .delete()
        .eq("id", ledgerIdA)
        .select("id");
      expect(remove.error?.code, `${label} delete`).toBe("42501");
    }

    expect(
      count(
        `select count(*) from public.appointment_payments where id = '${ledgerIdA}'::uuid and amount_cents = 4000;`,
      ),
    ).toBe(1);
  });
});

describe("RF-08 papéis sem policy leem zero linhas", () => {
  it("receptionist e professional do tenant A não leem o ledger", async () => {
    for (const user of [receptionist, professional]) {
      const { data, error } = await user.client.from("appointment_payments").select("id");
      expect(error, user.email).toBeNull();
      expect(data ?? [], user.email).toHaveLength(0);
    }
  });

  it("super_admin não tem caminho ao ledger", async () => {
    const { data, error } = await superAdmin.client.from("appointment_payments").select("id");
    expect(error).toBeNull();
    expect(data ?? []).toHaveLength(0);
  });
});

describe("RF-08 charges mantém a policy admin-only (sem regressão)", () => {
  it("admin A vê a cobrança do próprio tenant; receptionist vê zero", async () => {
    const adminView = await tenantA.admin.client.from("charges").select("id, tenant_id");
    expect(adminView.error).toBeNull();
    expect(adminView.data ?? []).toHaveLength(1);
    expect(adminView.data?.[0]?.id).toBe(chargeIdA);

    const receptionView = await receptionist.client.from("charges").select("id");
    expect(receptionView.error).toBeNull();
    expect(receptionView.data ?? []).toHaveLength(0);
  });

  it("nenhuma policy nova de escrita foi criada em charges", () => {
    const writePolicies = count(
      `select count(*) from pg_policies
        where schemaname = 'public' and tablename = 'charges' and cmd <> 'SELECT';`,
    );
    expect(writePolicies).toBe(0);
  });
});
