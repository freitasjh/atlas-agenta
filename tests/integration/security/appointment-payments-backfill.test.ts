// Backfill e idempotência do ledger (ADR-001; RF-01, RF-09; I4, I9). O bloco `DO` é lido do
// arquivo da migration para provar o SQL publicado, não uma cópia divergente no teste.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
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

const MIGRATION_PATH = fileURLToPath(
  new URL(
    "../../../supabase/migrations/20261106120000_appointment_payments_ledger.sql",
    import.meta.url,
  ),
);

/** Extrai o único bloco `DO $$ ... $$;` da migration (o backfill). */
function backfillBlock(): string {
  const raw = readFileSync(MIGRATION_PATH, "utf8");
  const start = raw.indexOf("do $$");
  const end = raw.indexOf("$$;", start);
  if (start < 0 || end < 0) throw new Error("Bloco de backfill não encontrado na migration.");
  return raw.slice(start, end + 3);
}

function runBackfill(): void {
  sql(backfillBlock());
}

function count(query: string, vars: Record<string, string> = {}): number {
  return Number(sql(query, vars));
}

/** Query de contagem de pagas sem atendimento, extraída do bloco `DO` da migration. */
function paidWithoutAppointmentQuery(): string {
  const match = backfillBlock().match(/select count\(\*\) into pagas_sem_atendimento[\s\S]*?;/i);
  if (!match) throw new Error("Query de pagas sem atendimento não encontrada no bloco da migration.");
  return match[0].replace(/into\s+pagas_sem_atendimento/i, "").replace(/;\s*$/, "");
}

let tenant: PaymentsTenant;
let paidFixture: AppointmentFixture;
let pendingFixture: AppointmentFixture;
let paidWithAppointment: string;
let paidWithoutAppointment: string;
let paidWithoutAppointment2: string;
let pendingCharge: string;
let baselinePaidWithoutAppointment = 0;
const paidAt = new Date("2026-11-01T12:00:00.000Z").toISOString();

beforeAll(async () => {
  tenant = await createPaymentsTenant("payments-backfill");
  baselinePaidWithoutAppointment = count(paidWithoutAppointmentQuery());
  paidFixture = await seedAppointment(tenant.tenantId, { priceCents: 10_000 });
  pendingFixture = await seedAppointment(tenant.tenantId, { priceCents: 7_500 });

  paidWithAppointment = await seedCharge({
    tenantId: tenant.tenantId,
    appointmentId: paidFixture.appointmentId,
    amountCents: 10_000,
    status: "pago",
    paidAt,
  });
  paidWithoutAppointment = await seedCharge({
    tenantId: tenant.tenantId,
    appointmentId: null,
    amountCents: 3_000,
    status: "pago",
    paidAt,
  });
  paidWithoutAppointment2 = await seedCharge({
    tenantId: tenant.tenantId,
    appointmentId: null,
    amountCents: 4_500,
    status: "pago",
    paidAt,
  });
  pendingCharge = await seedCharge({
    tenantId: tenant.tenantId,
    appointmentId: pendingFixture.appointmentId,
    amountCents: 7_500,
    status: "pendente",
  });

  runBackfill();
});

afterAll(async () => {
  await cleanupPaymentFixtures([tenant.tenantId]);
  await deleteTestUsers();
});

describe("RF-09 backfill 1:1 das cobranças pagas", () => {
  it("cada cobrança paga com atendimento vira uma linha pix_sistema/asaas", () => {
    expect(
      count(
        `select count(*) from public.appointment_payments
          where tenant_id = :'tenant'::uuid and charge_id = :'charge'::uuid;`,
        { tenant: tenant.tenantId, charge: paidWithAppointment },
      ),
    ).toBe(1);

    expect(
      sql(
        `select method || '|' || source || '|' || amount_cents || '|' || tip_cents
                || '|' || (received_at = :'paid_at'::timestamptz)
           from public.appointment_payments
          where tenant_id = :'tenant'::uuid and charge_id = :'charge'::uuid;`,
        { tenant: tenant.tenantId, charge: paidWithAppointment, paid_at: paidAt },
      ),
    ).toBe("pix_sistema|asaas|10000|0|true");
  });

  it("a soma da receita backfilled bate com a soma das cobranças pagas", () => {
    const ledgerSum = count(
      `select coalesce(sum(amount_cents), 0) from public.appointment_payments
        where tenant_id = :'tenant'::uuid and voided_at is null
          and charge_id = :'charge'::uuid;`,
      { tenant: tenant.tenantId, charge: paidWithAppointment },
    );
    const charged = count(
      `select amount_cents from public.charges where id = :'charge'::uuid;`,
      { charge: paidWithAppointment },
    );
    expect(ledgerSum).toBe(charged);
  });

  it("não sobra cobrança paga com atendimento fora do ledger", () => {
    expect(
      count(
        `select count(*) from public.charges c
          where c.tenant_id = :'tenant'::uuid
            and c.status = 'pago' and c.appointment_id is not null
            and not exists (
              select 1 from public.appointment_payments p
               where p.tenant_id = c.tenant_id and p.charge_id = c.id
            );`,
        { tenant: tenant.tenantId },
      ),
    ).toBe(0);
  });

  it("cobrança paga sem atendimento não entra no ledger", () => {
    for (const charge of [paidWithoutAppointment, paidWithoutAppointment2]) {
      expect(
        count(`select count(*) from public.appointment_payments where charge_id = :'charge'::uuid;`, {
          charge,
        }),
        charge,
      ).toBe(0);
      expect(count(`select count(*) from public.charges where id = :'charge'::uuid;`, { charge })).toBe(
        1,
      );
    }
  });

  it("cobrança pendente não vira receita", () => {
    expect(
      count(`select count(*) from public.appointment_payments where charge_id = :'charge'::uuid;`, {
        charge: pendingCharge,
      }),
    ).toBe(0);
  });

  it("a query de pagas sem atendimento da migration retorna o número esperado do fixture", () => {
    // A expressão é extraída do bloco `DO` publicado, não copiada no teste.
    expect(count(paidWithoutAppointmentQuery())).toBe(baselinePaidWithoutAppointment + 2);
  });
});

describe("RF-09/RF-01 reexecução do backfill é idempotente", () => {
  it("reexecutar o bloco publicado não insere linha nova", () => {
    const before = count(
      `select count(*) from public.appointment_payments where tenant_id = :'tenant'::uuid;`,
      { tenant: tenant.tenantId },
    );
    expect(() => runBackfill()).not.toThrow();
    expect(() => runBackfill()).not.toThrow();
    const after = count(
      `select count(*) from public.appointment_payments where tenant_id = :'tenant'::uuid;`,
      { tenant: tenant.tenantId },
    );
    expect(after).toBe(before);
  });
});

describe("I9 linha estornada não entra na receita", () => {
  it("estorno permanece no histórico e sai da soma", async () => {
    const { error } = await serviceClient()
      .from("appointment_payments")
      .insert({
        tenant_id: tenant.tenantId,
        appointment_id: paidFixture.appointmentId,
        method: "dinheiro",
        amount_cents: 2_000,
        voided_at: new Date().toISOString(),
        voided_by: tenant.admin.id,
        void_reason: "estorno no caixa",
      });
    expect(error).toBeNull();

    const revenue = count(
      `select coalesce(sum(amount_cents), 0) from public.appointment_payments
        where tenant_id = :'tenant'::uuid and voided_at is null
          and appointment_id = :'appointment'::uuid;`,
      { tenant: tenant.tenantId, appointment: paidFixture.appointmentId },
    );
    const history = count(
      `select count(*) from public.appointment_payments
        where tenant_id = :'tenant'::uuid and appointment_id = :'appointment'::uuid;`,
      { tenant: tenant.tenantId, appointment: paidFixture.appointmentId },
    );
    expect(revenue).toBe(10_000);
    expect(history).toBe(2);
  });
});

describe("D-02 cobrança paga com valor zero aborta o backfill", () => {
  it("guarda detecta amount_cents <= 0 e levanta exceção com a contagem", async () => {
    const brokenFixture = await seedAppointment(tenant.tenantId);
    const brokenCharge = await seedCharge({
      tenantId: tenant.tenantId,
      appointmentId: brokenFixture.appointmentId,
      amountCents: 0,
      status: "pago",
      paidAt,
    });

    let thrown: unknown;
    try {
      runBackfill();
    } catch (err) {
      thrown = err;
    }
    expect(String(thrown)).toContain("amount_cents <= 0");

    // A cobrança inválida não pode ficar paga: o backfill global voltaria a abortar.
    const { error } = await serviceClient()
      .from("charges")
      .update({ status: "cancelado" })
      .eq("id", brokenCharge);
    expect(error).toBeNull();
    expect(
      count(`select count(*) from public.appointment_payments where charge_id = :'charge'::uuid;`, {
        charge: brokenCharge,
      }),
    ).toBe(0);
  });
});
