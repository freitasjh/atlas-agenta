// Contrato das RPCs de pagamento (ADR-002; RF-01, 02, 03, 05, 06, 07, 15, 16, 17).
// Catálogo/grants por SQL; escrita e atomicidade pela service role.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { serviceClient } from "../helpers/clients.ts";
import {
  cleanupPaymentFixtures,
  createPaymentsTenant,
  getAppointmentStatus,
  readSummary,
  seedAppointment,
  seedCharge,
  seedPayment,
  type PaymentsTenant,
} from "../helpers/payments-fixtures.ts";
import { sql } from "../helpers/sql.ts";
import { createTenantMember, deleteTestUsers, type TestUser } from "../helpers/users.ts";

let tenantA: PaymentsTenant;
let tenantB: PaymentsTenant;
let receptionist: TestUser;
let professional: TestUser;
let otherProfessional: TestUser;

const RPC_SIGNATURES: Record<string, string> = {
  appointment_payment_summary: "(uuid, uuid)",
  reserve_appointment_charge: "(uuid, uuid, uuid, int, uuid, timestamptz)",
  attach_charge_gateway_data: "(uuid, uuid, timestamptz, text, text, text, timestamptz)",
  claim_charge_gateway: "(uuid, uuid, int)",
  reopen_charge_for_reissue: "(uuid, uuid, timestamptz)",
  release_charge_reservation: "(uuid, uuid, uuid, timestamptz)",
  register_appointment_payments: "(uuid, uuid, uuid, jsonb, uuid, boolean)",
  settle_charge_payment: "(uuid, uuid, timestamptz, text, uuid, text)",
  cancel_charge: "(uuid, uuid, uuid, boolean, boolean)",
  void_appointment_payment: "(uuid, uuid, uuid, text)",
};

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

async function ledgerCount(tenantId: string, appointmentId: string): Promise<number> {
  return Number(
    sql(
      `select count(*) from public.appointment_payments
        where tenant_id = :'tenant'::uuid and appointment_id = :'appointment'::uuid;`,
      { tenant: tenantId, appointment: appointmentId },
    ),
  );
}

beforeAll(async () => {
  tenantA = await createPaymentsTenant("payments-rpc-a");
  tenantB = await createPaymentsTenant("payments-rpc-b");
  receptionist = await createTenantMember(tenantA.tenantId, "receptionist", "payments-rpc-recep");
  professional = await createTenantMember(tenantA.tenantId, "professional", "payments-rpc-prof");
  otherProfessional = await createTenantMember(
    tenantA.tenantId,
    "professional",
    "payments-rpc-prof-2",
  );
});

afterAll(async () => {
  await cleanupPaymentFixtures([tenantA.tenantId, tenantB.tenantId]);
  await deleteTestUsers();
});

describe("RF-01/I16 catálogo, security invoker, search_path e grants", () => {
  it("as 4 RPCs e as 3 primitivas existem com assinatura congelada", () => {
    for (const [name, signature] of Object.entries(RPC_SIGNATURES)) {
      expect(
        Number(
          sql(
            `select count(*) from pg_proc p
               join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and p.proname = '${name}'
                and p.oid = 'public.${name}${signature}'::regprocedure;`,
          ),
        ),
        name,
      ).toBe(1);
    }
  });

  it("nenhuma função é security definer e todas fixam search_path", () => {
    const rows = sql(
      `select proname || ':' || prosecdef || ':' || coalesce(array_to_string(proconfig, ','), '')
         from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and proname in ('appointment_payment_summary','reserve_appointment_charge',
                          'attach_charge_gateway_data','claim_charge_gateway',
                          'reopen_charge_for_reissue','release_charge_reservation',
                          'register_appointment_payments',
                          'settle_charge_payment','cancel_charge','void_appointment_payment')
        order by proname;`,
    );
    for (const line of rows.split("\n").filter(Boolean)) {
      expect(line).toContain(":false:search_path=public, pg_temp");
    }
  });

  it("anon/authenticated não executam; service_role executa", () => {
    const rows = sql(
      `select proname || ':' || has_function_privilege('anon', p.oid, 'execute')
                    || ':' || has_function_privilege('authenticated', p.oid, 'execute')
                    || ':' || has_function_privilege('service_role', p.oid, 'execute')
         from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and proname in ('appointment_payment_summary','reserve_appointment_charge',
                          'attach_charge_gateway_data','claim_charge_gateway',
                          'reopen_charge_for_reissue','release_charge_reservation',
                          'register_appointment_payments',
                          'settle_charge_payment','cancel_charge','void_appointment_payment')
        order by proname;`,
    );
    const lines = rows.split("\n").filter(Boolean);
    expect(lines.length).toBe(10);
    for (const line of lines) expect(line).toMatch(/:false:false:true$/);
  });
});

describe("BE-01/RF-16 appointment_payment_summary", () => {
  it("6000 pago + 3000 pendente de 10000 => remaining 1000 e aguardando_pix", async () => {
    const fixture = await seedAppointment(tenantA.tenantId, { priceCents: 10_000 });
    await seedPayment({
      tenantId: tenantA.tenantId,
      appointmentId: fixture.appointmentId,
      amountCents: 6_000,
    });
    const chargeId = await seedCharge({
      tenantId: tenantA.tenantId,
      appointmentId: fixture.appointmentId,
      amountCents: 3_000,
      status: "pendente",
    });

    const summary = await readSummary(tenantA.tenantId, fixture.appointmentId);
    expect(summary).toMatchObject({
      price_cents: 10_000,
      total_paid_cents: 6_000,
      reserved_cents: 3_000,
      remaining_cents: 1_000,
      payment_status: "aguardando_pix",
      pending_charge_id: chargeId,
      pending_charge_amount_cents: 3_000,
    });
  });

  it("total 0 sem linhas => quitado; linha estornada não soma; pendente vencida não reserva", async () => {
    const zero = await seedAppointment(tenantA.tenantId, { priceCents: 0 });
    const zeroSummary = await readSummary(tenantA.tenantId, zero.appointmentId);
    expect(zeroSummary).toMatchObject({
      total_paid_cents: 0,
      reserved_cents: 0,
      remaining_cents: 0,
      payment_status: "quitado",
    });

    const fixture = await seedAppointment(tenantA.tenantId, { priceCents: 10_000 });
    await seedPayment({
      tenantId: tenantA.tenantId,
      appointmentId: fixture.appointmentId,
      amountCents: 4_000,
      voidedAt: new Date().toISOString(),
      voidedBy: tenantA.admin.id,
      voidReason: "estorno",
    });
    await seedCharge({
      tenantId: tenantA.tenantId,
      appointmentId: fixture.appointmentId,
      amountCents: 3_000,
      status: "pendente",
      expiresAt: new Date(Date.now() - 3_600_000).toISOString(),
    });

    const summary = await readSummary(tenantA.tenantId, fixture.appointmentId);
    expect(summary).toMatchObject({
      total_paid_cents: 0,
      reserved_cents: 0,
      remaining_cents: 10_000,
      payment_status: "sem_pagamento",
      pending_charge_id: null,
    });
  });
});

describe("RF-02/I5 atomicidade concluir + registrar", () => {
  it("em_atendimento + close=true grava linhas, conclui e apura comissão no mesmo commit", async () => {
    const fixture = await seedAppointment(tenantA.tenantId, {
      status: "em_atendimento",
      priceCents: 10_000,
      professionalProfileId: professional.id,
    });
    const key = randomUUID();

    const { data, error } = await register(
      tenantA.tenantId,
      professional.id,
      fixture.appointmentId,
      [
        { method: "dinheiro", amount_cents: 6_000, tip_cents: 0 },
        { method: "cartao_debito", amount_cents: 4_000, tip_cents: 500 },
      ],
      key,
      true,
    );

    expect(error).toBeNull();
    expect(data).toMatchObject({
      appointment_status: "concluido",
      total_paid_cents: 10_000,
      tip_cents: 500,
      remaining_cents: 0,
      payment_status: "quitado",
      replayed: false,
    });
    expect((data as { payments: unknown[] }).payments).toHaveLength(2);
    expect(await getAppointmentStatus(fixture.appointmentId)).toBe("concluido");

    expect(
      Number(
        sql(
          `select count(*) from public.appointment_commissions
            where tenant_id = :'tenant'::uuid and appointment_id = :'appointment'::uuid;`,
          { tenant: tenantA.tenantId, appointment: fixture.appointmentId },
        ),
      ),
    ).toBe(1);
  });

  it("falha forçada na auditoria reverte linhas, status e comissão", async () => {
    const fixture = await seedAppointment(tenantA.tenantId, {
      status: "em_atendimento",
      priceCents: 10_000,
      professionalProfileId: professional.id,
    });
    const key = randomUUID();

    sql(
      `create or replace function public.__test_fail_audit()
       returns trigger language plpgsql as $$
       begin
         raise exception 'forced audit failure';
       end;
       $$;
       drop trigger if exists __test_fail_audit on public.audit_log;
       create trigger __test_fail_audit
         before insert on public.audit_log
         for each row
         when (new.action = 'payment_registered' and new.actor_id = :'actor'::uuid)
         execute function public.__test_fail_audit();`,
      { actor: professional.id },
    );

    try {
      const { error } = await register(
        tenantA.tenantId,
        professional.id,
        fixture.appointmentId,
        [{ method: "dinheiro", amount_cents: 10_000 }],
        key,
        true,
      );
      expect(error).not.toBeNull();
      expect(await getAppointmentStatus(fixture.appointmentId)).toBe("em_atendimento");
      expect(await ledgerCount(tenantA.tenantId, fixture.appointmentId)).toBe(0);
      expect(
        Number(
          sql(
            `select count(*) from public.appointment_commissions
              where tenant_id = :'tenant'::uuid and appointment_id = :'appointment'::uuid;`,
            { tenant: tenantA.tenantId, appointment: fixture.appointmentId },
          ),
        ),
      ).toBe(0);
    } finally {
      sql(
        `drop trigger if exists __test_fail_audit on public.audit_log;
         drop function if exists public.__test_fail_audit();`,
      );
    }
  });
});

describe("RF-03/I6 replay e conflito do lote", () => {
  it("replay idêntico devolve replayed=true sem duplicar; payload diferente => IDEMPOTENCY_CONFLICT", async () => {
    const fixture = await seedAppointment(tenantA.tenantId, {
      status: "em_atendimento",
      priceCents: 10_000,
    });
    const key = randomUUID();
    const payments = [
      { method: "dinheiro", amount_cents: 6_000 },
      { method: "cartao_debito", amount_cents: 4_000 },
    ];

    const first = await register(tenantA.tenantId, tenantA.admin.id, fixture.appointmentId, payments, key);
    expect(first.error).toBeNull();
    expect((first.data as Record<string, unknown>).replayed).toBe(false);

    const replay = await register(tenantA.tenantId, tenantA.admin.id, fixture.appointmentId, payments, key);
    expect(replay.error).toBeNull();
    expect(replay.data).toMatchObject({ replayed: true, total_paid_cents: 10_000 });
    expect(await ledgerCount(tenantA.tenantId, fixture.appointmentId)).toBe(2);

    const changed = await register(
      tenantA.tenantId,
      tenantA.admin.id,
      fixture.appointmentId,
      [{ method: "dinheiro", amount_cents: 9_000 }],
      key,
    );
    expect(changed.error?.code).toBe("PT409");
    expect(changed.error?.message).toBe("IDEMPOTENCY_CONFLICT");
    expect(await ledgerCount(tenantA.tenantId, fixture.appointmentId)).toBe(2);
  });

  it("mesma chave em outro atendimento => IDEMPOTENCY_CONFLICT", async () => {
    const first = await seedAppointment(tenantA.tenantId, { status: "em_atendimento" });
    const second = await seedAppointment(tenantA.tenantId, { status: "em_atendimento" });
    const key = randomUUID();

    const a = await register(
      tenantA.tenantId,
      tenantA.admin.id,
      first.appointmentId,
      [{ method: "dinheiro", amount_cents: 1_000 }],
      key,
    );
    expect(a.error).toBeNull();

    const b = await register(
      tenantA.tenantId,
      tenantA.admin.id,
      second.appointmentId,
      [{ method: "dinheiro", amount_cents: 1_000 }],
      key,
    );
    expect(b.error?.code).toBe("PT409");
    expect(b.error?.message).toBe("IDEMPOTENCY_CONFLICT");
    expect(await ledgerCount(tenantA.tenantId, second.appointmentId)).toBe(0);
  });

  it("chave já usada por charge de outro atendimento => 409 antes de qualquer escrita", async () => {
    const first = await seedAppointment(tenantA.tenantId, { status: "concluido" });
    const second = await seedAppointment(tenantA.tenantId, { status: "em_atendimento" });
    const key = randomUUID();
    await seedCharge({
      tenantId: tenantA.tenantId,
      appointmentId: first.appointmentId,
      amountCents: 3_000,
      status: "pendente",
      idempotencyKey: key,
    });

    const conflict = await register(
      tenantA.tenantId,
      tenantA.admin.id,
      second.appointmentId,
      [{ method: "dinheiro", amount_cents: 1_000 }],
      key,
    );
    expect(conflict.error?.code).toBe("PT409");
    expect(conflict.error?.message).toBe("IDEMPOTENCY_CONFLICT");
    expect(await ledgerCount(tenantA.tenantId, second.appointmentId)).toBe(0);
    expect(await getAppointmentStatus(second.appointmentId)).toBe("em_atendimento");
    expect(
      Number(
        sql(
          `select count(*) from public.audit_log
            where tenant_id = :'tenant'::uuid and action = 'payment_registered'
              and target_id in (select id from public.appointment_payments
                                 where tenant_id = :'tenant'::uuid
                                   and appointment_id = :'appointment'::uuid);`,
          { tenant: tenantA.tenantId, appointment: second.appointmentId },
        ),
      ),
    ).toBe(0);
  });

  it("amount_cents não numérico => PT400 INVALID_AMOUNT (nunca 5xx)", async () => {
    const fixture = await seedAppointment(tenantA.tenantId, {
      status: "em_atendimento",
      priceCents: 10_000,
    });
    const { error } = await register(
      tenantA.tenantId,
      tenantA.admin.id,
      fixture.appointmentId,
      [{ method: "dinheiro", amount_cents: "1000" }],
      randomUUID(),
      true,
    );
    expect(error?.code).toBe("PT400");
    expect(error?.message).toBe("INVALID_AMOUNT");
    expect(await ledgerCount(tenantA.tenantId, fixture.appointmentId)).toBe(0);
  });

  it("pix_sistema é intenção: não vira linha e devolve pix_amount_cents", async () => {
    const fixture = await seedAppointment(tenantA.tenantId, {
      status: "em_atendimento",
      priceCents: 10_000,
    });
    const { data, error } = await register(
      tenantA.tenantId,
      tenantA.admin.id,
      fixture.appointmentId,
      [
        { method: "dinheiro", amount_cents: 7_000 },
        { method: "pix_sistema", amount_cents: 3_000 },
      ],
      randomUUID(),
      true,
    );
    expect(error).toBeNull();
    expect(data).toMatchObject({ total_paid_cents: 7_000, pix_amount_cents: 3_000 });
    expect((data as { payments: unknown[] }).payments).toHaveLength(1);
    expect(
      Number(
        sql(
          `select count(*) from public.appointment_payments
            where tenant_id = :'tenant'::uuid and appointment_id = :'appointment'::uuid
              and method = 'pix_sistema';`,
          { tenant: tenantA.tenantId, appointment: fixture.appointmentId },
        ),
      ),
    ).toBe(0);
  });
});

describe("RF-05/RF-06 lote vazio e total zero", () => {
  it("payments=[] + close=true conclui, audita e não cria cobrança", async () => {
    const fixture = await seedAppointment(tenantA.tenantId, {
      status: "em_atendimento",
      priceCents: 10_000,
    });
    const { data, error } = await register(
      tenantA.tenantId,
      receptionist.id,
      fixture.appointmentId,
      [],
      randomUUID(),
      true,
    );
    expect(error).toBeNull();
    expect(data).toMatchObject({ appointment_status: "concluido", total_paid_cents: 0 });
    expect(await getAppointmentStatus(fixture.appointmentId)).toBe("concluido");
    expect(
      Number(
        sql(
          `select count(*) from public.audit_log
            where tenant_id = :'tenant'::uuid
              and action = 'appointment_concluded_without_payment'
              and target_id = :'appointment'::uuid;`,
          { tenant: tenantA.tenantId, appointment: fixture.appointmentId },
        ),
      ),
    ).toBe(1);
    expect(
      Number(
        sql(
          `select count(*) from public.charges
            where tenant_id = :'tenant'::uuid and appointment_id = :'appointment'::uuid;`,
          { tenant: tenantA.tenantId, appointment: fixture.appointmentId },
        ),
      ),
    ).toBe(0);
  });

  it("total 0: [] conclui e settlement devolve quitado; linha positiva é rejeitada", async () => {
    const fixture = await seedAppointment(tenantA.tenantId, {
      status: "em_atendimento",
      priceCents: 0,
    });
    const ok = await register(
      tenantA.tenantId,
      tenantA.admin.id,
      fixture.appointmentId,
      [],
      randomUUID(),
      true,
    );
    expect(ok.error).toBeNull();
    expect(ok.data).toMatchObject({ total_paid_cents: 0, payment_status: "quitado" });

    const other = await seedAppointment(tenantA.tenantId, {
      status: "em_atendimento",
      priceCents: 0,
    });
    const rejected = await register(
      tenantA.tenantId,
      tenantA.admin.id,
      other.appointmentId,
      [{ method: "dinheiro", amount_cents: 1 }],
      randomUUID(),
      true,
    );
    expect(rejected.error?.code).toBe("PT409");
    expect(rejected.error?.message).toBe("AMOUNT_EXCEEDS_REMAINING");
    expect(await getAppointmentStatus(other.appointmentId)).toBe("em_atendimento");
  });

  it("lote excedendo o saldo não altera linha, status nem comissão", async () => {
    const fixture = await seedAppointment(tenantA.tenantId, {
      status: "em_atendimento",
      priceCents: 10_000,
    });
    const { error } = await register(
      tenantA.tenantId,
      tenantA.admin.id,
      fixture.appointmentId,
      [
        { method: "dinheiro", amount_cents: 6_000 },
        { method: "cartao_credito", amount_cents: 5_000 },
      ],
      randomUUID(),
      true,
    );
    expect(error?.code).toBe("PT409");
    expect(error?.message).toBe("AMOUNT_EXCEEDS_REMAINING");
    expect(await getAppointmentStatus(fixture.appointmentId)).toBe("em_atendimento");
    expect(await ledgerCount(tenantA.tenantId, fixture.appointmentId)).toBe(0);
  });
});

describe("RF-07/I3 profissional só o próprio atendimento", () => {
  it("profissional dono registra; profissional alheio recebe PROFESSIONAL_NOT_OWNER", async () => {
    const own = await seedAppointment(tenantA.tenantId, {
      status: "em_atendimento",
      professionalProfileId: professional.id,
    });
    const ownResult = await register(
      tenantA.tenantId,
      professional.id,
      own.appointmentId,
      [{ method: "dinheiro", amount_cents: 1_000 }],
      randomUUID(),
      true,
    );
    expect(ownResult.error).toBeNull();

    const other = await seedAppointment(tenantA.tenantId, {
      status: "em_atendimento",
      professionalProfileId: otherProfessional.id,
    });
    const denied = await register(
      tenantA.tenantId,
      professional.id,
      other.appointmentId,
      [{ method: "dinheiro", amount_cents: 1_000 }],
      randomUUID(),
      false,
    );
    expect(denied.error?.code).toBe("PT403");
    expect(denied.error?.message).toBe("PROFESSIONAL_NOT_OWNER");
    expect(await ledgerCount(tenantA.tenantId, other.appointmentId)).toBe(0);
  });

  it("atendimento de outro tenant => APPOINTMENT_NOT_FOUND e nada escrito", async () => {
    const fixtureB = await seedAppointment(tenantB.tenantId, {
      status: "em_atendimento",
    });
    const result = await register(
      tenantA.tenantId,
      tenantA.admin.id,
      fixtureB.appointmentId,
      [{ method: "dinheiro", amount_cents: 1_000 }],
      randomUUID(),
      false,
    );
    expect(result.error?.code).toBe("PT404");
    expect(result.error?.message).toBe("APPOINTMENT_NOT_FOUND");
    expect(await ledgerCount(tenantB.tenantId, fixtureB.appointmentId)).toBe(0);
  });
});
