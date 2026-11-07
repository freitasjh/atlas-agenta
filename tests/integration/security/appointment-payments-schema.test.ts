// Schemas e invariantes do ledger `appointment_payments` (ADR-001; RF-02..RF-05, RF-10;
// I1–I6, I10). Catálogo conferido por SQL direto; restrições exercitadas pela service role,
// que bypassa RLS e portanto prova apenas o que é DDL (checks, uniques, FKs).
import { randomUUID } from "node:crypto";
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
import { deleteTestUsers } from "../helpers/users.ts";

let tenantA: PaymentsTenant;
let tenantB: PaymentsTenant;
let baseA: AppointmentFixture;

function count(query: string): number {
  return Number(sql(query));
}

async function insertPayment(row: Record<string, unknown>) {
  return serviceClient().from("appointment_payments").insert(row);
}

async function insertPaymentWithId(row: Record<string, unknown>): Promise<string> {
  const { data, error } = await serviceClient()
    .from("appointment_payments")
    .insert(row)
    .select("id")
    .single();
  if (error || !data) throw new Error(`Insert de fixture falhou (código ${error?.code ?? "vazio"}).`);
  return data.id;
}

beforeAll(async () => {
  tenantA = await createPaymentsTenant("payments-schema-a");
  tenantB = await createPaymentsTenant("payments-schema-b");
  baseA = await seedAppointment(tenantA.tenantId);
});

afterAll(async () => {
  await cleanupPaymentFixtures([tenantA.tenantId, tenantB.tenantId]);
  await deleteTestUsers();
});

describe("RF-02 catálogo do ledger", () => {
  it("tabela appointment_payments existe em public", () => {
    expect(
      count(
        `select count(*) from pg_class c
           join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'public' and c.relname = 'appointment_payments' and c.relkind = 'r';`,
      ),
    ).toBe(1);
  });

  it("todas as 17 colunas existem com os tipos declarados", () => {
    const columns = sql(
      `select string_agg(column_name, ',' order by column_name)
         from information_schema.columns
        where table_schema = 'public' and table_name = 'appointment_payments';`,
    );
    expect(columns.split(",").sort()).toEqual(
      [
        "id",
        "tenant_id",
        "appointment_id",
        "charge_id",
        "method",
        "amount_cents",
        "tip_cents",
        "source",
        "idempotency_key",
        "line_index",
        "received_at",
        "received_by",
        "voided_at",
        "voided_by",
        "void_reason",
        "created_at",
        "lote_signature",
      ].sort(),
    );
    expect(
      sql(
        `select string_agg(column_name || ':' || data_type, ',' order by column_name)
           from information_schema.columns
          where table_schema = 'public' and table_name = 'appointment_payments'
            and column_name in ('amount_cents','tip_cents','line_index','received_at','created_at');`,
      ),
    ).toBe(
      "amount_cents:integer,created_at:timestamp with time zone,line_index:smallint,received_at:timestamp with time zone,tip_cents:integer",
    );
  });

  it("checks de enums, valores e estorno estão no catálogo", () => {
    const checks = sql(
      `select string_agg(conname, ',' order by conname)
         from pg_constraint
        where conrelid = 'public.appointment_payments'::regclass and contype = 'c';`,
    );
    expect(checks.split(",").sort()).toEqual(
      [
        "appointment_payments_amount_cents_check",
        "appointment_payments_line_index_check",
        "appointment_payments_lote_signature_check",
        "appointment_payments_method_check",
        "appointment_payments_source_check",
        "appointment_payments_tip_cents_check",
        "appointment_payments_void_consistent",
      ].sort(),
    );
  });

  it("as 4 FKs compostas por tenant existem e a de cobrança leva o atendimento", () => {
    const foreignKeys = sql(
      `select string_agg(conname || ':' || array_length(conkey, 1), ',' order by conname)
         from pg_constraint
        where conrelid = 'public.appointment_payments'::regclass and contype = 'f'
          and array_length(conkey, 1) >= 2;`,
    );
    expect(foreignKeys.split(",").sort()).toEqual(
      [
        "appointment_payments_appointment_fk:2",
        "appointment_payments_charge_fk:3",
        "appointment_payments_received_by_fk:2",
        "appointment_payments_voided_by_fk:2",
      ].sort(),
    );
    expect(
      sql(
        `select string_agg(a.attname, ',' order by k.ord)
           from pg_constraint c
           cross join lateral unnest(c.conkey) with ordinality as k(attnum, ord)
           join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum
          where c.conrelid = 'public.appointment_payments'::regclass
            and c.conname = 'appointment_payments_charge_fk';`,
      ),
    ).toBe("tenant_id,charge_id,appointment_id");
    expect(
      sql(
        `select string_agg(a.attname, ',' order by k.ord)
           from pg_constraint c
           cross join lateral unnest(c.confkey) with ordinality as k(attnum, ord)
           join pg_attribute a on a.attrelid = c.confrelid and a.attnum = k.attnum
          where c.conrelid = 'public.appointment_payments'::regclass
            and c.conname = 'appointment_payments_charge_fk';`,
      ),
    ).toBe("tenant_id,id,appointment_id");
  });

  it("os 4 índices de consulta existem", () => {
    for (const index of [
      "appointment_payments_tenant_appointment_idx",
      "appointment_payments_tenant_received_idx",
      "appointment_payments_tenant_method_received_idx",
      "appointment_payments_tenant_voided_idx",
    ]) {
      expect(
        count(
          `select count(*) from pg_indexes
            where schemaname = 'public' and indexname = '${index}';`,
        ),
        index,
      ).toBe(1);
    }
  });
});

describe("RF-03 charges gateway-only", () => {
  it("idempotency_key existe e o unique global por appointment_id saiu", () => {
    expect(
      count(
        `select count(*) from information_schema.columns
          where table_schema = 'public' and table_name = 'charges' and column_name = 'idempotency_key';`,
      ),
    ).toBe(1);
    expect(
      count(
        `select count(*) from pg_indexes
          where schemaname = 'public' and indexname = 'charges_appointment_id_uidx';`,
      ),
    ).toBe(0);
  });

  it("uniques por tenant (id, atendimento, idempotência) existem", () => {
    for (const index of [
      "charges_tenant_id_id_uidx",
      "charges_tenant_id_id_appointment_uidx",
      "charges_tenant_appointment_uidx",
      "charges_tenant_idem_uidx",
    ]) {
      expect(
        count(
          `select count(*) from pg_indexes
            where schemaname = 'public' and indexname = '${index}';`,
        ),
        index,
      ).toBe(1);
    }
  });
});

describe("I1–I3 defaults, fronteiras e estorno consistente", () => {
  it("linha mínima persiste com os defaults do ledger", async () => {
    const id = await insertPaymentWithId({
      tenant_id: tenantA.tenantId,
      appointment_id: baseA.appointmentId,
      method: "dinheiro",
      amount_cents: 10_000,
    });

    const { data, error } = await serviceClient()
      .from("appointment_payments")
      .select("tip_cents, source, line_index, received_at, voided_at, voided_by, void_reason")
      .eq("id", id)
      .single();
    expect(error).toBeNull();
    expect(data).toMatchObject({
      tip_cents: 0,
      source: "manual",
      line_index: 0,
      voided_at: null,
      voided_by: null,
      void_reason: null,
    });
    expect(data?.received_at).toBeTruthy();
  });

  it("fronteiras válidas: amount_cents=1, tip_cents=0 e line_index=49", async () => {
    const receivedAt = new Date().toISOString();
    const { error } = await insertPayment({
      tenant_id: tenantA.tenantId,
      appointment_id: baseA.appointmentId,
      method: "pix_maquininha",
      amount_cents: 1,
      tip_cents: 0,
      line_index: 49,
      received_at: receivedAt,
    });
    expect(error).toBeNull();
  });

  it("amount_cents=0, method inválido e line_index=50 falham com 23514", async () => {
    const invalidRows: Array<Record<string, unknown>> = [
      {
        tenant_id: tenantA.tenantId,
        appointment_id: baseA.appointmentId,
        method: "dinheiro",
        amount_cents: 0,
      },
      {
        tenant_id: tenantA.tenantId,
        appointment_id: baseA.appointmentId,
        method: "boleto",
        amount_cents: 100,
      },
      {
        tenant_id: tenantA.tenantId,
        appointment_id: baseA.appointmentId,
        method: "dinheiro",
        amount_cents: 100,
        line_index: 50,
      },
      {
        tenant_id: tenantA.tenantId,
        appointment_id: baseA.appointmentId,
        method: "dinheiro",
        amount_cents: 100,
        source: "webhook",
      },
    ];
    for (const row of invalidRows) {
      const { error } = await insertPayment(row);
      expect(error?.code, JSON.stringify(row)).toBe("23514");
    }
  });

  it("voided_* inconsistente falha com 23514", async () => {
    const inconsistent: Array<Record<string, unknown>> = [
      {
        tenant_id: tenantA.tenantId,
        appointment_id: baseA.appointmentId,
        method: "dinheiro",
        amount_cents: 100,
        voided_at: new Date().toISOString(),
      },
      {
        tenant_id: tenantA.tenantId,
        appointment_id: baseA.appointmentId,
        method: "dinheiro",
        amount_cents: 100,
        voided_at: new Date().toISOString(),
        voided_by: tenantA.admin.id,
      },
      {
        tenant_id: tenantA.tenantId,
        appointment_id: baseA.appointmentId,
        method: "dinheiro",
        amount_cents: 100,
        voided_at: new Date().toISOString(),
        voided_by: tenantA.admin.id,
        void_reason: "   ",
      },
    ];
    for (const row of inconsistent) {
      const { error } = await insertPayment(row);
      expect(error?.code, JSON.stringify(row)).toBe("23514");
    }
  });
});

describe("RF-04/I4 um recebimento por cobrança", () => {
  it("segunda linha com o mesmo (tenant_id, charge_id) falha com 23505", async () => {
    const fixture = await seedAppointment(tenantA.tenantId);
    const chargeId = await seedCharge({
      tenantId: tenantA.tenantId,
      appointmentId: fixture.appointmentId,
    });

    const first = await insertPayment({
      tenant_id: tenantA.tenantId,
      appointment_id: fixture.appointmentId,
      charge_id: chargeId,
      method: "pix_sistema",
      amount_cents: 5_000,
      source: "asaas",
    });
    expect(first.error).toBeNull();

    const second = await insertPayment({
      tenant_id: tenantA.tenantId,
      appointment_id: fixture.appointmentId,
      charge_id: chargeId,
      method: "pix_sistema",
      amount_cents: 5_000,
      source: "asaas",
    });
    expect(second.error?.code).toBe("23505");
  });

  it("charge_id nulo não colide entre linhas", async () => {
    const fixture = await seedAppointment(tenantA.tenantId);
    for (const method of ["dinheiro", "cartao_credito", "cartao_debito"]) {
      const { error } = await insertPayment({
        tenant_id: tenantA.tenantId,
        appointment_id: fixture.appointmentId,
        method,
        amount_cents: 1_000,
      });
      expect(error).toBeNull();
    }
  });
});

describe("RF-05/I5 idempotência por lote", () => {
  it("mesma (tenant_id, idempotency_key, line_index) falha; line_index distinto passa", async () => {
    const fixture = await seedAppointment(tenantA.tenantId);
    const key = randomUUID();

    const first = await insertPayment({
      tenant_id: tenantA.tenantId,
      appointment_id: fixture.appointmentId,
      method: "cartao_credito",
      amount_cents: 2_000,
      idempotency_key: key,
      line_index: 0,
    });
    expect(first.error).toBeNull();

    const replay = await insertPayment({
      tenant_id: tenantA.tenantId,
      appointment_id: fixture.appointmentId,
      method: "cartao_credito",
      amount_cents: 2_000,
      idempotency_key: key,
      line_index: 0,
    });
    expect(replay.error?.code).toBe("23505");

    const otherLine = await insertPayment({
      tenant_id: tenantA.tenantId,
      appointment_id: fixture.appointmentId,
      method: "cartao_credito",
      amount_cents: 2_000,
      idempotency_key: key,
      line_index: 1,
    });
    expect(otherLine.error).toBeNull();
  });

  it("idempotency_key nula não colide", async () => {
    const fixture = await seedAppointment(tenantA.tenantId);
    for (let i = 0; i < 2; i += 1) {
      const { error } = await insertPayment({
        tenant_id: tenantA.tenantId,
        appointment_id: fixture.appointmentId,
        method: "dinheiro",
        amount_cents: 500,
        idempotency_key: null,
      });
      expect(error).toBeNull();
    }
  });
});

describe("I6/I10 cap de 1 PIX por atendimento", () => {
  it("segunda cobrança no mesmo atendimento falha, inclusive após a primeira ser paga", async () => {
    const fixture = await seedAppointment(tenantA.tenantId);
    const chargeId = await seedCharge({
      tenantId: tenantA.tenantId,
      appointmentId: fixture.appointmentId,
    });

    const duplicated = await serviceClient().from("charges").insert({
      tenant_id: tenantA.tenantId,
      appointment_id: fixture.appointmentId,
      amount_cents: 10_000,
    });
    expect(duplicated.error?.code).toBe("23505");

    const paid = await serviceClient()
      .from("charges")
      .update({ status: "pago", paid_at: new Date().toISOString() })
      .eq("id", chargeId);
    expect(paid.error).toBeNull();

    const afterPaid = await serviceClient().from("charges").insert({
      tenant_id: tenantA.tenantId,
      appointment_id: fixture.appointmentId,
      amount_cents: 10_000,
    });
    expect(afterPaid.error?.code).toBe("23505");
  });

  it("cobrança sem atendimento não colide com outra do mesmo tenant", async () => {
    for (let i = 0; i < 2; i += 1) {
      const { error } = await serviceClient().from("charges").insert({
        tenant_id: tenantA.tenantId,
        appointment_id: null,
        amount_cents: 1_000,
      });
      expect(error).toBeNull();
    }
  });
});

describe("I7/RF-06 FKs compostas rejeitam referência de outro tenant", () => {
  it("atendimento, cobrança, received_by e voided_by de outro tenant falham com 23503", async () => {
    const fixtureB = await seedAppointment(tenantB.tenantId);
    const chargeB = await seedCharge({
      tenantId: tenantB.tenantId,
      appointmentId: fixtureB.appointmentId,
    });

    const crossTenantRows: Array<Record<string, unknown>> = [
      {
        tenant_id: tenantA.tenantId,
        appointment_id: fixtureB.appointmentId,
        method: "dinheiro",
        amount_cents: 100,
      },
      {
        tenant_id: tenantA.tenantId,
        appointment_id: baseA.appointmentId,
        charge_id: chargeB,
        method: "pix_sistema",
        amount_cents: 100,
        source: "asaas",
      },
      {
        tenant_id: tenantA.tenantId,
        appointment_id: baseA.appointmentId,
        method: "dinheiro",
        amount_cents: 100,
        received_by: tenantB.admin.id,
      },
      {
        tenant_id: tenantA.tenantId,
        appointment_id: baseA.appointmentId,
        method: "dinheiro",
        amount_cents: 100,
        voided_at: new Date().toISOString(),
        voided_by: tenantB.admin.id,
        void_reason: "estorno",
      },
    ];
    for (const row of crossTenantRows) {
      const { error } = await insertPayment(row);
      expect(error?.code, JSON.stringify(row)).toBe("23503");
    }
  });
});

describe("I7 cobrança do ledger pertence ao atendimento da linha", () => {
  it("cobrança de outro atendimento do mesmo tenant falha com 23503", async () => {
    const appointmentA = await seedAppointment(tenantA.tenantId);
    const appointmentB = await seedAppointment(tenantA.tenantId);
    const chargeOfB = await seedCharge({
      tenantId: tenantA.tenantId,
      appointmentId: appointmentB.appointmentId,
      status: "pago",
    });

    const { error } = await insertPayment({
      tenant_id: tenantA.tenantId,
      appointment_id: appointmentA.appointmentId,
      charge_id: chargeOfB,
      method: "pix_sistema",
      amount_cents: 5_000,
      source: "asaas",
    });
    expect(error?.code).toBe("23503");
  });

  it("cobrança sem atendimento (assinatura) não casa com linha do ledger", async () => {
    const appointment = await seedAppointment(tenantA.tenantId);
    const subscriptionCharge = await seedCharge({
      tenantId: tenantA.tenantId,
      appointmentId: null,
      status: "pago",
    });

    const { error } = await insertPayment({
      tenant_id: tenantA.tenantId,
      appointment_id: appointment.appointmentId,
      charge_id: subscriptionCharge,
      method: "pix_sistema",
      amount_cents: 5_000,
      source: "asaas",
    });
    expect(error?.code).toBe("23503");
  });

  it("charge_id nulo continua aceito (a FK não é verificada)", async () => {
    const appointment = await seedAppointment(tenantA.tenantId);
    const { error } = await insertPayment({
      tenant_id: tenantA.tenantId,
      appointment_id: appointment.appointmentId,
      charge_id: null,
      method: "dinheiro",
      amount_cents: 1_200,
    });
    expect(error).toBeNull();
  });
});

describe("I8 tenant_id fail-closed", () => {
  it("default current_tenant_id() resolve nulo sob service role", () => {
    expect(sql("select current_tenant_id() is null;")).toBe("t");
  });

  it("insert sem tenant_id sob service role falha em not-null (23502)", async () => {
    const { error } = await insertPayment({
      appointment_id: baseA.appointmentId,
      method: "dinheiro",
      amount_cents: 500,
    });
    expect(error?.code).toBe("23502");
    expect(
      count("select count(*) from public.appointment_payments where tenant_id is null;"),
    ).toBe(0);
  });
});

describe("I9 receita ignora linha estornada", () => {
  it("linha estornada permanece no histórico e sai da soma de receita", async () => {
    const fixture = await seedAppointment(tenantA.tenantId);
    await insertPaymentWithId({
      tenant_id: tenantA.tenantId,
      appointment_id: fixture.appointmentId,
      method: "dinheiro",
      amount_cents: 5_000,
    });
    await insertPaymentWithId({
      tenant_id: tenantA.tenantId,
      appointment_id: fixture.appointmentId,
      method: "cartao_credito",
      amount_cents: 3_000,
      voided_at: new Date().toISOString(),
      voided_by: tenantA.admin.id,
      void_reason: "estorno solicitado pelo cliente",
    });

    const revenue = sql(
      `select coalesce(sum(amount_cents), 0) from public.appointment_payments
        where tenant_id = :'tenant'::uuid and appointment_id = :'appointment'::uuid
          and voided_at is null;`,
      { tenant: tenantA.tenantId, appointment: fixture.appointmentId },
    );
    expect(Number(revenue)).toBe(5_000);

    const history = sql(
      `select count(*) from public.appointment_payments
        where tenant_id = :'tenant'::uuid and appointment_id = :'appointment'::uuid;`,
      { tenant: tenantA.tenantId, appointment: fixture.appointmentId },
    );
    expect(Number(history)).toBe(2);
  });
});
