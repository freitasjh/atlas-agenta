// Regressão dos bugs P0 da Fase 0 (roadmap-oficial-v1.md §5).
//   G1 — a comissão usa o snapshot do preço no ato do agendamento, não o preço na conclusão,
//        e o snapshot é imutável após o agendamento (23514).
//   G3 — agendado `concluido` sai do índice de conflito da constraint appointments_no_overlap
//        (status final é histórico, não reserva de slot).
// G2 (estorno reverte comissão) foi escalado como decisão de contrato financeiro/produto —
// ver o retorno do batch 0.1. Não há teste de G2 aqui de propósito: sem a confirmação do
// produto, um teste vermelho quebraria a suíte (H2).
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { serviceClient } from "../helpers/clients.ts";
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
} from "../helpers/payments-fixtures.ts";
import { sql } from "../helpers/sql.ts";
import { deleteTestUsers } from "../helpers/users.ts";

const tenantsToCleanup: string[] = [];

async function newTenant(prefix: string): Promise<PaymentsTenant> {
  const tenant = await createPaymentsTenant(prefix);
  tenantsToCleanup.push(tenant.tenantId);
  const { error } = await serviceClient()
    .from("tenants")
    .update({ plan: "premium" })
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

function commissionCents(tenantId: string, appointmentId: string): number | null {
  const out = sql(
    `select commission_cents from public.appointment_commissions
      where tenant_id = :'tenant'::uuid and appointment_id = :'appointment'::uuid;`,
    { tenant: tenantId, appointment: appointmentId },
  );
  return out === "" ? null : Number(out);
}

function commissionBaseCents(tenantId: string, appointmentId: string): number | null {
  const out = sql(
    `select commission_base_cents from public.appointments
      where tenant_id = :'tenant'::uuid and id = :'appointment'::uuid;`,
    { tenant: tenantId, appointment: appointmentId },
  );
  return out === "" ? null : Number(out);
}

afterAll(async () => {
  await cleanupPaymentFixtures(tenantsToCleanup);
  await deleteTestUsers();
});

describe("G1 — comissão é snapshot do preço do agendamento", () => {
  it("alterar price_cents entre agendar e concluir mantém a comissão do preço agendado", async () => {
    const tenant = await newTenant("fase0-g1");
    const fixture = await seedAppointment(tenant.tenantId, {
      status: "em_atendimento",
      priceCents: 10_000,
    });
    await seedCommissionPct(tenant.tenantId, fixture.professionalId, 30);

    // O preço muda depois do agendamento (correção, desconto, erro de lançamento).
    const { error: priceError } = await serviceClient()
      .from("appointments")
      .update({ price_cents: 20_000 })
      .eq("id", fixture.appointmentId);
    expect(priceError).toBeNull();

    const { error } = await register(
      tenant.tenantId,
      tenant.admin.id,
      fixture.appointmentId,
      [],
      randomUUID(),
      true,
    );
    expect(error).toBeNull();
    expect(await getAppointmentStatus(fixture.appointmentId)).toBe("concluido");

    // 30% de 10_000 (preço agendado), não 30% de 20_000 (preço na conclusão).
    expect(commissionCents(tenant.tenantId, fixture.appointmentId)).toBe(3_000);

    // O snapshot fica travado no preço do agendamento, independente da edição.
    expect(commissionBaseCents(tenant.tenantId, fixture.appointmentId)).toBe(10_000);
  });

  it("commission_base_cents é imutável após o agendamento (23514)", async () => {
    const tenant = await newTenant("fase0-freeze");
    const fixture = await seedAppointment(tenant.tenantId, { priceCents: 10_000 });
    expect(commissionBaseCents(tenant.tenantId, fixture.appointmentId)).toBe(10_000);

    // O trigger `appointments_freeze_commission_base` barra o UPDATE da coluna
    // (mesmo caminho do service role): o snapshot não pode ser reescrito.
    const { error } = await serviceClient()
      .from("appointments")
      .update({ commission_base_cents: 99_999 })
      .eq("id", fixture.appointmentId);
    expect(error?.code).toBe("23514");
    expect(commissionBaseCents(tenant.tenantId, fixture.appointmentId)).toBe(10_000);
  });
});

describe("G3 — agendado concluído não ocupa slot", () => {
  it("walk-in sobre agendado já concluído não viola a exclusão (23P01)", async () => {
    const tenant = await newTenant("fase0-g3");
    await setTenantSegment(tenant.tenantId, "barbearia");
    const catalog = await seedWalkInCatalog(tenant.tenantId, {
      linkService: true,
      withCustomer: true,
    });

    // Agendado cobrindo a janela em que a venda walk-in vai nascer (`now()` do RPC).
    const startsAt = new Date(Date.now() - 60_000);
    const endsAt = new Date(Date.now() + 30 * 60_000);
    const scheduled = await serviceClient()
      .from("appointments")
      .insert({
        tenant_id: tenant.tenantId,
        origin: "agendado",
        customer_id: catalog.customerId,
        professional_id: catalog.professionalId,
        service_id: catalog.serviceId,
        starts_at: startsAt.toISOString(),
        ends_at: endsAt.toISOString(),
        price_cents: 10_000,
        status: "em_atendimento",
      })
      .select("id")
      .single();
    expect(scheduled.error).toBeNull();
    const scheduledId = scheduled.data?.id as string;

    const concluded = await register(
      tenant.tenantId,
      tenant.admin.id,
      scheduledId,
      [],
      randomUUID(),
      true,
    );
    expect(concluded.error).toBeNull();
    expect(await getAppointmentStatus(scheduledId)).toBe("concluido");

    // O concluído é histórico: a venda walk-in no mesmo profissional e janela deve suceder.
    const walkIn = await callCreateWalkIn({
      tenantId: tenant.tenantId,
      actorId: tenant.admin.id,
      professionalId: catalog.professionalId,
      serviceId: catalog.serviceId,
      creationIdempotencyKey: randomUUID(),
    });
    expect(walkIn.error).toBeNull();
  });
});
