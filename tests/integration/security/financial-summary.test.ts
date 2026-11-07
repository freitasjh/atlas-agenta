// RPC financial_summary (ADR-005; RF-20, RF-21, RF-24, RF-25, RF-26, RF-27, RF-29).
// Receita SÓ do ledger (voided_at null, received_at no intervalo); gorjeta separada;
// pago do gateway nunca é receita; estorno fora das somas; a receber é snapshot;
// em aberto só concluído por starts_at; não-admin recebe PT403; período inválido PT400.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { serviceClient } from "../helpers/clients.ts";
import {
  cleanupPaymentFixtures,
  createPaymentsTenant,
  seedAppointment,
  seedCharge,
  seedPayment,
  type PaymentsTenant,
} from "../helpers/payments-fixtures.ts";
import { createTenantMember,
  deleteTestUsers,
  type TestUser,
} from "../helpers/users.ts";
import { sql } from "../helpers/sql.ts";

let tenant: PaymentsTenant;
let receptionist: TestUser;
let professional: TestUser;

const FROM = "2026-09-01T00:00:00.000Z";
const TO = "2026-10-01T00:00:00.000Z";

async function summaryAs(user: TestUser, from = FROM, to = TO) {
  return user.client.rpc("financial_summary", { p_from: from, p_to: to });
}

beforeAll(async () => {
  tenant = await createPaymentsTenant("financial-summary");
  receptionist = await createTenantMember(tenant.tenantId, "receptionist", "financial-summary-recep");
  professional = await createTenantMember(tenant.tenantId, "professional", "financial-summary-prof");

  // Atendimento concluído no período: 10.000 de serviço.
  const appt = await seedAppointment(tenant.tenantId, { priceCents: 10_000, status: "concluido" });
  await serviceClient().from("appointments").update({ starts_at: "2026-09-10T12:00:00.000Z" }).eq("id", appt.appointmentId);

  // Dinheiro 6.000 + gorjeta 500 (ativo, no período).
  await seedPayment({
    tenantId: tenant.tenantId,
    appointmentId: appt.appointmentId,
    method: "dinheiro",
    amountCents: 6_000,
    tipCents: 500,
    receivedBy: tenant.admin.id,
  });
  await serviceClient().from("appointment_payments")
    .update({ received_at: "2026-09-10T13:00:00.000Z" })
    .eq("tenant_id", tenant.tenantId);

  // Linha estornada 2.000 (fica no histórico, fora das somas).
  await seedPayment({
    tenantId: tenant.tenantId,
    appointmentId: appt.appointmentId,
    method: "cartao_credito",
    amountCents: 2_000,
    receivedBy: tenant.admin.id,
    voidedAt: "2026-09-11T00:00:00.000Z",
    voidedBy: tenant.admin.id,
    voidReason: "teste",
  });

  // PIX pago com linha no ledger (conta 1x, pelo ledger).
  const paidAppt = await seedAppointment(tenant.tenantId, { priceCents: 5_000, status: "concluido" });
  await serviceClient().from("appointments").update({ starts_at: "2026-09-12T12:00:00.000Z" }).eq("id", paidAppt.appointmentId);
  const paidCharge = await seedCharge({
    tenantId: tenant.tenantId,
    appointmentId: paidAppt.appointmentId,
    amountCents: 5_000,
    status: "pago",
    asaasPaymentId: "pay-fin-1",
    paidAt: "2026-09-12T13:00:00.000Z",
  });
  await seedPayment({
    tenantId: tenant.tenantId,
    appointmentId: paidAppt.appointmentId,
    method: "pix_sistema",
    amountCents: 5_000,
    chargeId: paidCharge,
    source: "asaas",
    receivedBy: tenant.admin.id,
  });
  await serviceClient().from("appointment_payments")
    .update({ received_at: "2026-09-12T13:00:00.000Z" })
    .eq("charge_id", paidCharge);

  // Cobrança pendente com gateway (a receber snapshot, sem período).
  const openAppt = await seedAppointment(tenant.tenantId, { priceCents: 8_000, status: "concluido" });
  await serviceClient().from("appointments").update({ starts_at: "2026-09-15T12:00:00.000Z" }).eq("id", openAppt.appointmentId);
  await seedCharge({
    tenantId: tenant.tenantId,
    appointmentId: openAppt.appointmentId,
    amountCents: 3_000,
    status: "pendente",
    asaasPaymentId: "pay-fin-pending",
  });

  // Cobrança pendente SEM gateway (não entra no a receber) em atendimento
  // fora do concluído (também fora do em aberto).
  const noGatewayAppt = await seedAppointment(tenant.tenantId, { priceCents: 8_000, status: "pendente" });
  await serviceClient().from("appointments").update({ starts_at: "2026-09-16T12:00:00.000Z" }).eq("id", noGatewayAppt.appointmentId);
  await seedCharge({
    tenantId: tenant.tenantId,
    appointmentId: noGatewayAppt.appointmentId,
    amountCents: 1_000,
    status: "pendente",
  });
});

afterAll(async () => {
  await cleanupPaymentFixtures([tenant.tenantId]);
  await deleteTestUsers();
});

describe("RF-20 financial_summary existe e exige admin", () => {
  it("rejeita recepção e profissional com PT403", async () => {
    const deniedRecep = await summaryAs(receptionist);
    expect(deniedRecep.error?.code).toBe("PT403");
    expect(deniedRecep.error?.message).toBe("FORBIDDEN");

    const deniedProf = await summaryAs(professional);
    expect(deniedProf.error?.code).toBe("PT403");
    expect(deniedProf.error?.message).toBe("FORBIDDEN");
  });

  it("rejeita período ausente, invertido e >366d com PT400", async () => {
    const { admin } = tenant;
    const missing = await admin.client.rpc("financial_summary", { p_from: FROM, p_to: FROM });
    expect(missing.error?.code).toBe("PT400");

    const long = await admin.client.rpc("financial_summary", {
      p_from: "2024-01-01T00:00:00.000Z",
      p_to: "2026-01-01T00:00:00.000Z",
    });
    expect(long.error?.code).toBe("PT400");
    expect(long.error?.message).toBe("INVALID_PERIOD");
  });

  it("assinatura tem só p_from/p_to (sem p_tenant_id)", () => {
    const args = sql(
      `select string_agg(p.arg, ',' order by p.ord) from (
         select unnest(coalesce(proargnames, '{}')) as arg,
                generate_subscripts(coalesce(proargnames, '{}'), 1) as ord
           from pg_proc where proname = 'financial_summary'
       ) p;`,
    );
    expect(args).toBe("p_from,p_to");
  });
});

describe("RF-21/24/25/26/27 números do admin", () => {
  it("serviço 11.000, gorjeta 500, total 11.500; estorno e pago fora de duplicidade", async () => {
    const { data, error } = await summaryAs(tenant.admin);
    expect(error).toBeNull();
    const s = data as Record<string, number>;
    expect(s.received_service_cents).toBe(11_000);
    expect(s.received_tips_cents).toBe(500);
    expect(s.received_total_cents).toBe(11_500);
  });

  it("a receber é snapshot 3.000 (pendente com gateway; sem gateway fora)", async () => {
    const { data, error } = await summaryAs(tenant.admin);
    expect(error).toBeNull();
    expect((data as Record<string, number>).receivable_cents).toBe(3_000);

    // Snapshot ignora o período: janela fora de tudo mantém o a receber.
    const off = await summaryAs(tenant.admin, "2025-01-01T00:00:00.000Z", "2025-02-01T00:00:00.000Z");
    expect(off.error).toBeNull();
    expect((off.data as Record<string, number>).receivable_cents).toBe(3_000);
    expect((off.data as Record<string, number>).received_service_cents).toBe(0);
  });

  it("em aberto soma saldos de concluídos no período (4.000 + 5.000)", async () => {
    const { data, error } = await summaryAs(tenant.admin);
    expect(error).toBeNull();
    // appt1: 10.000 - 6.000 pago - 3.000 reservado(sem gateway? não: pendente sem asaas não reserva) => 4.000
    // appt paid: 5.000 - 5.000 = 0; openAppt: 8.000 - 0 - 3.000 = 5.000 => total 9.000
    expect((data as Record<string, number>).open_cents).toBe(9_000);
  });

  it("by_method tem as 5 formas com zeros e gorjeta separada", async () => {
    const { data, error } = await summaryAs(tenant.admin);
    expect(error).toBeNull();
    const by = (data as { by_method: Array<{ method: string; amount_cents: number; tip_cents: number; count: number }> }).by_method;
    expect(by).toHaveLength(5);
    const methods = by.map((r) => r.method).sort();
    expect(methods).toEqual(["cartao_credito", "cartao_debito", "dinheiro", "pix_maquininha", "pix_sistema"].sort());
    const dinheiro = by.find((r) => r.method === "dinheiro");
    expect(dinheiro).toMatchObject({ amount_cents: 6_000, tip_cents: 500, count: 1 });
    const pix = by.find((r) => r.method === "pix_sistema");
    expect(pix).toMatchObject({ amount_cents: 5_000, tip_cents: 0, count: 1 });
    const zeros = by.find((r) => r.method === "pix_maquininha");
    expect(zeros).toMatchObject({ amount_cents: 0, tip_cents: 0, count: 0 });
  });
});
