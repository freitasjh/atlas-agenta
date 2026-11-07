// Cutover/backfill idempotente do ledger (ADR-003; RF-15). Roda contra Postgres real.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { serviceClient } from "../helpers/clients.ts";
import {
  cleanupPaymentFixtures,
  createPaymentsTenant,
  encryptAsaasKey,
  seedAppointment,
  seedAsaasConfig,
  seedCharge,
  type PaymentsTenant,
} from "../helpers/payments-fixtures.ts";
import { sql } from "../helpers/sql.ts";
import { deleteTestUsers } from "../helpers/users.ts";

const PAID_AT = "2026-11-01T12:00:00.000Z";

let tenantA: PaymentsTenant;
let tenantB: PaymentsTenant;
let validChargeA = "";
let invalidChargeA = "";
let paidChargeB = "";

interface BackfillResult {
  candidates: number;
  inserted: number;
  missing_after: number;
  skipped_invalid_amount: number;
}

function count(query: string, vars: Record<string, string> = {}): number {
  return Number(sql(query, vars));
}

async function backfill(tenantId: string | null): Promise<BackfillResult> {
  const { data, error } = await serviceClient().rpc(
    "reconcile_appointment_payments_backfill",
    tenantId === null ? {} : { p_tenant_id: tenantId },
  );
  if (error) throw new Error(`RPC de backfill falhou (código ${error.code ?? "vazio"}).`);
  return data as BackfillResult;
}

beforeAll(async () => {
  tenantA = await createPaymentsTenant("cutover-a");
  tenantB = await createPaymentsTenant("cutover-b");
  await seedAsaasConfig({
    tenantId: tenantA.tenantId,
    encryptedKey: encryptAsaasKey("x"),
  });
  await seedAsaasConfig({
    tenantId: tenantB.tenantId,
    encryptedKey: encryptAsaasKey("x"),
  });

  const appointmentA = await seedAppointment(tenantA.tenantId, { priceCents: 5_000 });
  validChargeA = await seedCharge({
    tenantId: tenantA.tenantId,
    appointmentId: appointmentA.appointmentId,
    amountCents: 5_000,
    status: "pago",
    paidAt: PAID_AT,
  });

  const invalidAppointment = await seedAppointment(tenantA.tenantId, { priceCents: 0 });
  invalidChargeA = await seedCharge({
    tenantId: tenantA.tenantId,
    appointmentId: invalidAppointment.appointmentId,
    amountCents: 0,
    status: "pago",
    paidAt: PAID_AT,
  });

  const appointmentB = await seedAppointment(tenantB.tenantId, { priceCents: 2_500 });
  paidChargeB = await seedCharge({
    tenantId: tenantB.tenantId,
    appointmentId: appointmentB.appointmentId,
    amountCents: 2_500,
    status: "pago",
    paidAt: PAID_AT,
  });
});

afterAll(async () => {
  await cleanupPaymentFixtures([tenantA.tenantId, tenantB.tenantId]);
  await deleteTestUsers();
});

describe("RF-15 backfill de cutover", () => {
  it("cria uma linha por cobrança paga sem ledger e isola o tenant", async () => {
    const result = await backfill(tenantA.tenantId);

    // `candidates` conta só `amount_cents > 0`; o inválido é reportado à parte em
    // `skipped_invalid_amount` e não entra na aritmética do cutover.
    expect(result.candidates).toBe(1);
    expect(result.inserted).toBe(result.candidates);
    expect(result.missing_after).toBe(0);
    expect(result.skipped_invalid_amount).toBe(1);

    expect(
      sql(
        `select method || '|' || source || '|' || amount_cents || '|' || tip_cents
                || '|' || (received_at = :'paid_at'::timestamptz)
           from public.appointment_payments
          where tenant_id = :'tenant'::uuid and charge_id = :'charge'::uuid;`,
        { tenant: tenantA.tenantId, charge: validChargeA, paid_at: PAID_AT },
      ),
    ).toBe("pix_sistema|asaas|5000|0|true");

    expect(
      count(`select count(*) from public.appointment_payments where charge_id = :'charge'::uuid;`, {
        charge: invalidChargeA,
      }),
    ).toBe(0);

    // Tenant B intocado pela execução escopada em A.
    expect(
      count(`select count(*) from public.appointment_payments where charge_id = :'charge'::uuid;`, {
        charge: paidChargeB,
      }),
    ).toBe(0);
  });

  it("reexecução é idempotente e não duplica receita", async () => {
    const result = await backfill(tenantA.tenantId);

    expect(result.candidates).toBe(0);
    expect(result.inserted).toBe(result.candidates);
    expect(result.missing_after).toBe(0);
    expect(
      count(
        `select count(*) from public.appointment_payments
          where tenant_id = :'tenant'::uuid and charge_id = :'charge'::uuid;`,
        { tenant: tenantA.tenantId, charge: validChargeA },
      ),
    ).toBe(1);
  });

  it("execução no tenant B também é idempotente", async () => {
    const first = await backfill(tenantB.tenantId);
    expect(first.candidates).toBe(1);
    expect(first.inserted).toBe(first.candidates);
    expect(first.missing_after).toBe(0);

    const second = await backfill(tenantB.tenantId);
    expect(second.candidates).toBe(0);
    expect(second.inserted).toBe(second.candidates);
    expect(second.missing_after).toBe(0);
  });

  it("não sobra cobrança paga com atendimento fora do ledger", async () => {
    expect(
      count(
        `select count(*) from public.charges c
          where c.tenant_id in (:'tenant_a'::uuid, :'tenant_b'::uuid)
            and c.status = 'pago' and c.appointment_id is not null and c.amount_cents > 0
            and not exists (
              select 1 from public.appointment_payments p
               where p.tenant_id = c.tenant_id and p.charge_id = c.id
            );`,
        { tenant_a: tenantA.tenantId, tenant_b: tenantB.tenantId },
      ),
    ).toBe(0);
  });

  it("execução global mantém missing_after=0", async () => {
    const result = await backfill(null);
    expect(result.missing_after).toBe(0);
    expect(
      count(
        `select count(*) from public.charges c
          where c.status = 'pago' and c.appointment_id is not null and c.amount_cents > 0
            and not exists (
              select 1 from public.appointment_payments p
               where p.tenant_id = c.tenant_id and p.charge_id = c.id
            );`,
      ),
    ).toBe(0);
  });

  it("audita a reconciliação", async () => {
    const { data, error } = await serviceClient()
      .from("audit_log")
      .select("tenant_id, metadata")
      .eq("action", "appointment_payments_backfill_reconciled")
      .eq("tenant_id", tenantA.tenantId)
      .order("created_at", { ascending: false })
      .limit(1);
    expect(error).toBeNull();
    expect(data?.[0]?.metadata.missing_after).toBe(0);
  });

  it("só service_role executa a função", async () => {
    expect(
      sql(
        "select has_function_privilege('anon','public.reconcile_appointment_payments_backfill(uuid)','execute');",
      ),
    ).toBe("f");
    expect(
      sql(
        "select has_function_privilege('authenticated','public.reconcile_appointment_payments_backfill(uuid)','execute');",
      ),
    ).toBe("f");
    expect(
      sql(
        "select has_function_privilege('service_role','public.reconcile_appointment_payments_backfill(uuid)','execute');",
      ),
    ).toBe("t");
  });
});
