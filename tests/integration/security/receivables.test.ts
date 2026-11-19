// Contas a receber avulsas (ADR-07; RF-18..21 + PRD §6.4/§7).
// receivables/receivable_settlements: escrita só via RPCs admin (sem policy de
// write); settlements append-only; PIX idempotente por conta; webhook replay sem
// duplicar; ledger `appointment_payments` intocado.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { serviceClient } from "../helpers/clients.ts";
import { callFunction } from "../helpers/functions.ts";
import {
  cleanupPaymentFixtures,
  createPaymentsTenant,
  encryptAsaasKey,
  seedAppointment,
  seedAsaasConfig,
  seedPayment,
  type PaymentsTenant,
} from "../helpers/payments-fixtures.ts";
import { sql } from "../helpers/sql.ts";
import {
  createTenantMember,
  deleteTestUsers,
  type TestUser,
} from "../helpers/users.ts";

let tenantA: PaymentsTenant;
let tenantB: PaymentsTenant;
let receptionist: TestUser;
let professional: TestUser;
let customerOptIn: string;
let customerSemOptIn: string;
let ledgerFixture: { appointmentId: string; customerId: string };

function count(query: string): number {
  return Number(sql(query));
}

async function rpcAs(
  user: TestUser,
  fn: string,
  args: Record<string, unknown>,
): Promise<{ data: unknown; code?: string; message?: string }> {
  const { data, error } = await user.client.rpc(fn, args);
  return { data, code: error?.code, message: error?.message };
}

async function seedCustomer(
  tenantId: string,
  name: string,
  optIn: boolean,
): Promise<string> {
  const { data, error } = await serviceClient()
    .from("customers")
    .insert({ tenant_id: tenantId, name, phone: "11987654321", whatsapp_opt_in: optIn })
    .select("id")
    .single();
  if (error || !data) throw new Error(`Fixture customer falhou (código ${error?.code ?? "vazio"}).`);
  return (data as { id: string }).id;
}

async function seedReceivable(
  tenantId: string,
  customerId: string,
  over: Record<string, unknown> = {},
): Promise<string> {
  const { data, error } = await serviceClient()
    .from("receivables")
    .insert({
      tenant_id: tenantId,
      customer_id: customerId,
      descricao: `Avulsa ${randomUUID().slice(0, 6)}`,
      categoria: "avulsa",
      vencimento_at: new Date(Date.now() + 86_400_000).toISOString(),
      valor_cents: 10_000,
      ...over,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`Fixture receivable falhou (código ${error?.code ?? "vazio"}).`);
  return (data as { id: string }).id;
}

function recebimentosCount(receivableId: string): number {
  return count(`select count(*) from public.receivable_settlements where receivable_id = '${receivableId}';`);
}

beforeAll(async () => {
  tenantA = await createPaymentsTenant("receber-a");
  tenantB = await createPaymentsTenant("receber-b");
  receptionist = await createTenantMember(tenantA.tenantId, "receptionist", "receber-reception");
  professional = await createTenantMember(tenantA.tenantId, "professional", "receber-professional");

  customerOptIn = await seedCustomer(tenantA.tenantId, "Cliente com opt-in", true);
  customerSemOptIn = await seedCustomer(tenantA.tenantId, "Cliente sem opt-in", false);

  // Ledger de atendimento com 1 recebimento real (prova de "intocado").
  ledgerFixture = await seedAppointment(tenantA.tenantId, {
    status: "concluido",
    priceCents: 10_000,
  });
  await seedPayment({
    tenantId: tenantA.tenantId,
    appointmentId: ledgerFixture.appointmentId,
    amountCents: 10_000,
  });

  await seedAsaasConfig({
    tenantId: tenantA.tenantId,
    encryptedKey: encryptAsaasKey("chave-de-teste"),
    active: true,
    webhookToken: "token-receber-a",
  });
});

afterAll(async () => {
  sql("alter table public.receivable_settlements disable trigger receivable_settlements_no_update_delete;");
  try {
    const admin = serviceClient();
    for (const table of ["receivable_settlements", "receivables"] as const) {
      const { error } = await admin.from(table).delete().in("tenant_id", [tenantA.tenantId, tenantB.tenantId]);
      if (error) throw new Error(`Limpeza de ${table} falhou (código ${error.code ?? "sem código"}).`);
    }
  } finally {
    sql("alter table public.receivable_settlements enable trigger receivable_settlements_no_update_delete;");
  }
  await cleanupPaymentFixtures([tenantA.tenantId, tenantB.tenantId]);
  await deleteTestUsers();
});

describe("schema receivables/receivable_settlements", () => {
  it("tabelas existem com tenant_id, *_cents, timestamptz e FKs compostas", () => {
    for (const table of ["receivables", "receivable_settlements"]) {
      expect(
        count(
          `select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public' and c.relname = '${table}' and c.relkind = 'r';`,
        ),
        table,
      ).toBe(1);
    }

    expect(
      sql(
        `select string_agg(column_name || ':' || data_type, ',' order by column_name)
           from information_schema.columns
          where table_schema = 'public' and table_name = 'receivables'
            and column_name in ('valor_cents','vencimento_at','created_at');`,
      ),
    ).toBe("created_at:timestamp with time zone,valor_cents:integer,vencimento_at:timestamp with time zone");

    // Unique parcial: um pagamento do gateway por conta/tenant.
    expect(
      count(
        `select count(*) from pg_indexes
          where schemaname = 'public' and indexname = 'receivables_tenant_asaas_payment_uidx';`,
      ),
    ).toBe(1);
    // Unique do replay de webhook.
    expect(
      count(
        `select count(*) from pg_indexes
          where schemaname = 'public' and indexname = 'receivable_settlements_tenant_event_uidx';`,
      ),
    ).toBe(1);
  });

  it("RLS habilitado com exatamente uma policy de select admin por tabela", () => {
    for (const table of ["receivables", "receivable_settlements"]) {
      expect(
        count(
          `select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public' and c.relname = '${table}' and c.relrowsecurity;`,
        ),
        table,
      ).toBe(1);
      const policies = sql(
        `select string_agg(policyname || ':' || cmd, ',' order by policyname)
           from pg_policies where schemaname = 'public' and tablename = '${table}';`,
      );
      expect(policies).toBe(`${table}_select_tenant_admin:SELECT`);
    }
  });
});

describe("RF-19 criar avulsa (admin-only, categoria própria)", () => {
  it("admin cria conta pendente; recepção/profissional recebem FORBIDDEN", async () => {
    const ok = await rpcAs(tenantA.admin, "receivable_create", {
      p_customer_id: customerOptIn,
      p_descricao: "Produto fora do caixa",
      p_valor_cents: 5_000,
      p_vencimento_at: new Date(Date.now() + 86_400_000).toISOString(),
      p_categoria: "avulsa",
    });
    expect(ok.code).toBeUndefined();
    expect(ok.data).toMatchObject({ status: "pendente" });

    for (const user of [receptionist, professional]) {
      const denied = await rpcAs(user, "receivable_create", {
        p_customer_id: customerOptIn,
        p_descricao: "Tentativa",
        p_valor_cents: 1_000,
        p_vencimento_at: new Date().toISOString(),
      });
      expect(denied.code, user.email).toBe("PT403");
    }
  });

  it("cliente de outro tenant falha com PT404 e valor zero com PT400", async () => {
    const cross = await rpcAs(tenantA.admin, "receivable_create", {
      p_customer_id: await seedCustomer(tenantB.tenantId, "Cliente B", true),
      p_descricao: "Cruzada",
      p_valor_cents: 1_000,
      p_vencimento_at: new Date(Date.now() + 86_400_000).toISOString(),
    });
    expect(cross.code).toBe("PT404");

    const zero = await rpcAs(tenantA.admin, "receivable_create", {
      p_customer_id: customerOptIn,
      p_descricao: "Zero",
      p_valor_cents: 0,
      p_vencimento_at: new Date(Date.now() + 86_400_000).toISOString(),
    });
    expect(zero.code).toBe("PT400");
  });
});

describe("RF-20/21 recebimento parcial e total", () => {
  it("parcial mantém saldo; total quita; overpay e novo recebimento falham", async () => {
    const created = await rpcAs(tenantA.admin, "receivable_create", {
      p_customer_id: customerOptIn,
      p_descricao: "Serviço avulso",
      p_valor_cents: 10_000,
      p_vencimento_at: new Date(Date.now() + 86_400_000).toISOString(),
    });
    const receivableId = (created.data as { receivable_id: string }).receivable_id;

    const parcial = await rpcAs(tenantA.admin, "receivable_settle", {
      p_receivable_id: receivableId,
      p_valor_cents: 4_000,
      p_metodo: "pix",
    });
    expect(parcial.code).toBeUndefined();
    expect(parcial.data).toMatchObject({ status: "parcial", resto_cents: 6_000 });

    const over = await rpcAs(tenantA.admin, "receivable_settle", {
      p_receivable_id: receivableId,
      p_valor_cents: 7_000,
      p_metodo: "dinheiro",
    });
    expect(over.code).toBe("PT409");

    const total = await rpcAs(tenantA.admin, "receivable_settle", {
      p_receivable_id: receivableId,
      p_valor_cents: 6_000,
      p_metodo: "dinheiro",
    });
    expect(total.code).toBeUndefined();
    expect(total.data).toMatchObject({ status: "pago", resto_cents: 0 });

    const depois = await rpcAs(tenantA.admin, "receivable_settle", {
      p_receivable_id: receivableId,
      p_valor_cents: 100,
    });
    expect(depois.code).toBe("PT409");
    expect(recebimentosCount(receivableId)).toBe(2);
  });

  it("recepção não registra recebimento (PT403)", async () => {
    const receivableId = await seedReceivable(tenantA.tenantId, customerOptIn);
    const denied = await rpcAs(receptionist, "receivable_settle", {
      p_receivable_id: receivableId,
      p_valor_cents: 1_000,
    });
    expect(denied.code).toBe("PT403");
    expect(recebimentosCount(receivableId)).toBe(0);
  });

  it("conta com PIX vivo não aceita baixa manual nem cancelamento (C2)", async () => {
    const receivableId = await seedReceivable(tenantA.tenantId, customerOptIn, {
      asaas_payment_id: `pay-${randomUUID()}`,
      pix_copy_paste: "00020126copia-cola",
      charge_expires_at: new Date(Date.now() + 86_400_000).toISOString(),
    });

    // Cliente paga o PIX cheio; registrar só um parcial geraria caixa não registrado.
    const settle = await rpcAs(tenantA.admin, "receivable_settle", {
      p_receivable_id: receivableId,
      p_valor_cents: 4_000,
      p_metodo: "dinheiro",
    });
    expect(settle.code).toBe("PT409");
    expect(settle.message).toBe("RECEIVABLE_HAS_ACTIVE_CHARGE");
    expect(recebimentosCount(receivableId)).toBe(0);

    // Cancelar a conta deixaria um QR pagável na mão do cliente.
    const cancel = await rpcAs(tenantA.admin, "receivable_cancel", {
      p_receivable_id: receivableId,
      p_motivo: "Duplicada",
    });
    expect(cancel.code).toBe("PT409");
    expect(cancel.message).toBe("RECEIVABLE_HAS_ACTIVE_CHARGE");

    // Sem PIX (após o cancelamento na Edge) a baixa manual volta a funcionar.
    sql(
      `update public.receivables
          set asaas_payment_id = null, pix_copy_paste = null, charge_expires_at = null
        where id = '${receivableId}';`,
    );
    const liberado = await rpcAs(tenantA.admin, "receivable_settle", {
      p_receivable_id: receivableId,
      p_valor_cents: 1_000,
    });
    expect(liberado.code).toBeUndefined();
    expect(liberado.data).toMatchObject({ status: "parcial" });
  });

  it("settlements é append-only: update/delete falham mesmo pela service role", async () => {
    const { data } = await serviceClient()
      .from("receivable_settlements")
      .select("id")
      .eq("tenant_id", tenantA.tenantId)
      .limit(1)
      .single();
    const id = (data as { id: string }).id;
    const update = await serviceClient()
      .from("receivable_settlements")
      .update({ valor_cents: 1 })
      .eq("id", id);
    expect(update.error?.code).toBe("P0001");
    const remove = await serviceClient().from("receivable_settlements").delete().eq("id", id);
    expect(remove.error?.code).toBe("P0001");
  });

  it("conta com recebimento não cancela; conta sem recebimento cancela com auditoria", async () => {
    const comRecebimento = await seedReceivable(tenantA.tenantId, customerOptIn);
    await rpcAs(tenantA.admin, "receivable_settle", {
      p_receivable_id: comRecebimento,
      p_valor_cents: 1_000,
    });
    const bloqueado = await rpcAs(tenantA.admin, "receivable_cancel", {
      p_receivable_id: comRecebimento,
      p_motivo: "Tentativa",
    });
    expect(bloqueado.code).toBe("PT409");

    const semRecebimento = await seedReceivable(tenantA.tenantId, customerOptIn);
    const cancelada = await rpcAs(tenantA.admin, "receivable_cancel", {
      p_receivable_id: semRecebimento,
      p_motivo: "Duplicada",
    });
    expect(cancelada.code).toBeUndefined();
    expect(cancelada.data).toMatchObject({ status: "cancelado" });

    const audit = await tenantA.admin.client
      .from("audit_log")
      .select("action")
      .eq("target_id", semRecebimento)
      .eq("action", "receivable_cancelled");
    expect(audit.error).toBeNull();
    expect(audit.data ?? []).toHaveLength(1);
  });
});

describe("RF-40 idempotência do webhook", () => {
  it("liquida pelo valor REAL pago e audita o excedente sem engolir diferença (C2b)", async () => {
    const receivableId = await seedReceivable(tenantA.tenantId, customerOptIn, {
      asaas_payment_id: `pay-${randomUUID()}`,
      valor_cents: 10_000,
    });
    const eventId = `evt-${randomUUID()}`;

    const { data, error } = await serviceClient().rpc("receivable_settle_webhook", {
      p_tenant_id: tenantA.tenantId,
      p_receivable_id: receivableId,
      p_paid_at: new Date().toISOString(),
      p_event_id: eventId,
      p_paid_value_cents: 12_000,
    });
    expect(error).toBeNull();
    expect(data).toMatchObject({
      status: "pago",
      settled: true,
      valor_cents: 10_000,
      excess_cents: 2_000,
    });

    // Só o saldo entra como recebimento; o excedente fica auditado.
    expect(recebimentosCount(receivableId)).toBe(1);
    const audit = await serviceClient()
      .from("audit_log")
      .select("action, metadata")
      .eq("target_id", receivableId)
      .eq("action", "receivable_gateway_overpay");
    expect(audit.error).toBeNull();
    expect(audit.data ?? []).toHaveLength(1);
    expect((audit.data ?? [])[0]?.metadata).toMatchObject({
      paid_value_cents: 12_000,
      applied_cents: 10_000,
      excess_cents: 2_000,
    });
  });

  it("valor pago menor que o saldo deixa a conta parcial pelo valor real", async () => {
    const receivableId = await seedReceivable(tenantA.tenantId, customerOptIn, {
      asaas_payment_id: `pay-${randomUUID()}`,
      valor_cents: 10_000,
    });

    const { data, error } = await serviceClient().rpc("receivable_settle_webhook", {
      p_tenant_id: tenantA.tenantId,
      p_receivable_id: receivableId,
      p_paid_at: new Date().toISOString(),
      p_event_id: `evt-${randomUUID()}`,
      p_paid_value_cents: 4_000,
    });
    expect(error).toBeNull();
    expect(data).toMatchObject({ status: "parcial", settled: true, valor_cents: 4_000 });
  });

  it("replay do mesmo evento não duplica settlement; conta paga ignora novo evento", async () => {
    const receivableId = await seedReceivable(tenantA.tenantId, customerOptIn, {
      asaas_payment_id: `pay-${randomUUID()}`,
    });
    const eventId = `evt-${randomUUID()}`;

    const { data: first, error: firstError } = await serviceClient().rpc(
      "receivable_settle_webhook",
      {
        p_tenant_id: tenantA.tenantId,
        p_receivable_id: receivableId,
        p_paid_at: new Date().toISOString(),
        p_event_id: eventId,
      },
    );
    expect(firstError).toBeNull();
    expect(first).toMatchObject({ settled: true, replayed: false, status: "pago" });

    const { data: replay, error: replayError } = await serviceClient().rpc(
      "receivable_settle_webhook",
      {
        p_tenant_id: tenantA.tenantId,
        p_receivable_id: receivableId,
        p_paid_at: new Date().toISOString(),
        p_event_id: eventId,
      },
    );
    expect(replayError).toBeNull();
    expect(replay).toMatchObject({ settled: false, replayed: true, status: "pago" });

    const { data: atrasado, error: atrasadoError } = await serviceClient().rpc(
      "receivable_settle_webhook",
      {
        p_tenant_id: tenantA.tenantId,
        p_receivable_id: receivableId,
        p_paid_at: new Date().toISOString(),
        p_event_id: `evt-${randomUUID()}`,
      },
    );
    expect(atrasadoError).toBeNull();
    expect(atrasado).toMatchObject({ settled: false, replayed: true });

    expect(recebimentosCount(receivableId)).toBe(1);
  });

  it("RPC de webhook não é executável pelo cliente autenticado", async () => {
    const { error } = await tenantA.admin.client.rpc("receivable_settle_webhook", {
      p_tenant_id: tenantA.tenantId,
      p_receivable_id: randomUUID(),
      p_paid_at: null,
      p_event_id: null,
    });
    expect(error?.code).toBe("42501");
  });
});

describe("Leitura agregada e claim de cobrança (revisão 1)", () => {
  it("receivable_list soma os recebimentos no banco (não depende de janela na UI)", async () => {
    const created = await rpcAs(tenantA.admin, "receivable_create", {
      p_customer_id: customerOptIn,
      p_descricao: "Avulsa agregada",
      p_valor_cents: 10_000,
      p_vencimento_at: new Date(Date.now() + 86_400_000).toISOString(),
    });
    const receivableId = (created.data as { receivable_id: string }).receivable_id;

    await rpcAs(tenantA.admin, "receivable_settle", {
      p_receivable_id: receivableId,
      p_valor_cents: 2_500,
      p_metodo: "pix",
    });
    await rpcAs(tenantA.admin, "receivable_settle", {
      p_receivable_id: receivableId,
      p_valor_cents: 1_500,
      p_metodo: "dinheiro",
    });

    const { data, error } = await tenantA.admin.client.rpc("receivable_list");
    expect(error).toBeNull();
    const rows = data as Array<{ id: string; recebido_cents: number; pix_qr_code: string | null }>;
    const row = rows.find((item) => item.id === receivableId);
    expect(row?.recebido_cents).toBe(4_000);
    // QR (base64) não viaja na listagem: a UI usa o retorno da Edge.
    expect(row?.pix_qr_code).toBeNull();

    // Recepção não enxerga nada (RLS admin-only).
    const recepcao = await receptionist.client.rpc("receivable_list");
    expect(recepcao.error).toBeNull();
    expect(recepcao.data ?? []).toHaveLength(0);
  });

  it("claim é exclusivo: o segundo chamador não ganha e o cliente não executa", async () => {
    const receivableId = await seedReceivable(tenantA.tenantId, customerOptIn);
    const admin = serviceClient();

    const first = await admin.rpc("claim_receivable_gateway", {
      p_tenant_id: tenantA.tenantId,
      p_receivable_id: receivableId,
      p_ttl_seconds: 120,
    });
    expect(first.error).toBeNull();
    expect(first.data).toMatchObject({ claimed: true });

    const second = await admin.rpc("claim_receivable_gateway", {
      p_tenant_id: tenantA.tenantId,
      p_receivable_id: receivableId,
      p_ttl_seconds: 120,
    });
    expect(second.error).toBeNull();
    expect(second.data).toMatchObject({ claimed: false });

    const denied = await tenantA.admin.client.rpc("claim_receivable_gateway", {
      p_tenant_id: tenantA.tenantId,
      p_receivable_id: receivableId,
      p_ttl_seconds: 120,
    });
    expect(denied.error?.code).toBe("42501");
  });

  it("PIX expirado volta a ser elegível ao claim (reemissão)", async () => {
    const receivableId = await seedReceivable(tenantA.tenantId, customerOptIn, {
      asaas_payment_id: `pay-${randomUUID()}`,
      pix_copy_paste: "00020126copia-cola",
      charge_expires_at: new Date(Date.now() - 60_000).toISOString(),
    });

    const claim = await serviceClient().rpc("claim_receivable_gateway", {
      p_tenant_id: tenantA.tenantId,
      p_receivable_id: receivableId,
      p_ttl_seconds: 120,
    });
    expect(claim.error).toBeNull();
    expect(claim.data).toMatchObject({ claimed: true });
  });
});

describe("Fronteira do ledger (SSoT intocado)", () => {
  it("receivables não têm vínculo de atendimento; ledger permanece igual após avulsa paga", async () => {
    const antes = count(
      `select count(*) from public.appointment_payments where tenant_id = '${tenantA.tenantId}';`,
    );
    expect(antes).toBeGreaterThanOrEqual(1);

    expect(
      count(
        `select count(*) from information_schema.columns
          where table_schema = 'public' and table_name = 'receivables'
            and column_name in ('appointment_id','charge_id');`,
      ),
    ).toBe(0);

    const created = await rpcAs(tenantA.admin, "receivable_create", {
      p_customer_id: customerOptIn,
      p_descricao: "Avulsa que não entra no ledger",
      p_valor_cents: 3_000,
      p_vencimento_at: new Date(Date.now() + 86_400_000).toISOString(),
    });
    const receivableId = (created.data as { receivable_id: string }).receivable_id;
    await rpcAs(tenantA.admin, "receivable_settle", {
      p_receivable_id: receivableId,
      p_valor_cents: 3_000,
    });

    const depois = count(
      `select count(*) from public.appointment_payments where tenant_id = '${tenantA.tenantId}';`,
    );
    expect(depois).toBe(antes);
  });

  it("aba Atendimentos lê o ledger pela RPC e admin vê apenas o próprio tenant", async () => {
    const from = new Date(Date.now() - 30 * 86_400_000).toISOString();
    const to = new Date(Date.now() + 86_400_000).toISOString();
    const { data, error } = await tenantA.admin.client.rpc("receivable_ledger_list", {
      p_from: from,
      p_to: to,
    });
    expect(error).toBeNull();
    const rows = data as Array<{ id: string; customer_name: string | null }>;
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows.some((row) => row.id)).toBe(true);

    // Recepção não lê ledger financeiro (RLS de appointment_payments).
    const recepcao = await receptionist.client.rpc("receivable_ledger_list", {
      p_from: from,
      p_to: to,
    });
    expect(recepcao.error).toBeNull();
    expect(recepcao.data ?? []).toHaveLength(0);
  });
});

describe("RLS admin-only e isolamento por tenant", () => {
  it("admin A lê só o próprio tenant; recepção/profissional leem zero", async () => {
    await seedReceivable(tenantB.tenantId, await seedCustomer(tenantB.tenantId, "Cliente B2", true));

    const viewA = await tenantA.admin.client.from("receivables").select("id, tenant_id");
    expect(viewA.error).toBeNull();
    expect((viewA.data ?? []).length).toBeGreaterThanOrEqual(1);
    for (const row of viewA.data ?? []) expect(row.tenant_id).toBe(tenantA.tenantId);

    for (const user of [receptionist, professional]) {
      for (const table of ["receivables", "receivable_settlements"] as const) {
        const { data, error } = await user.client.from(table).select("id");
        expect(error, `${user.email} ${table}`).toBeNull();
        expect(data ?? [], `${user.email} ${table}`).toHaveLength(0);
      }
    }
  });

  it("insert/update/delete diretos falham com 42501 para admin e recepção", async () => {
    for (const { label, user } of [
      { label: "admin", user: tenantA.admin },
      { label: "receptionist", user: receptionist },
    ]) {
      const insert = await user.client.from("receivables").insert({
        tenant_id: tenantA.tenantId,
        customer_id: customerOptIn,
        descricao: "Direto",
        vencimento_at: new Date().toISOString(),
        valor_cents: 100,
      });
      expect(insert.error?.code, `${label} insert`).toBe("42501");

      const { data } = await serviceClient()
        .from("receivables")
        .select("id")
        .eq("tenant_id", tenantA.tenantId)
        .limit(1)
        .single();
      const id = (data as { id: string }).id;
      const update = await user.client.from("receivables").update({ descricao: "x" }).eq("id", id).select("id");
      expect(update.error?.code, `${label} update`).toBe("42501");
      const remove = await user.client.from("receivables").delete().eq("id", id).select("id");
      expect(remove.error?.code, `${label} delete`).toBe("42501");
    }
  });
});

describe("RF-19/21 cobrança PIX + WhatsApp (Edge create-receivable-charge)", () => {
  it("recepção não cobra (403)", async () => {
    const receivableId = await seedReceivable(tenantA.tenantId, customerOptIn);
    const response = await callFunction("create-receivable-charge", {
      token: receptionist.accessToken,
      body: { receivable_id: receivableId },
    });
    expect(response.status).toBe(403);
  });

  it("sem opt-in bloqueia antes do gateway e não enfileira mensagem", async () => {
    const receivableId = await seedReceivable(tenantA.tenantId, customerSemOptIn);
    const response = await callFunction("create-receivable-charge", {
      token: tenantA.admin.accessToken,
      body: { receivable_id: receivableId, notify_whatsapp: true },
    });
    expect(response.status).toBe(422);
    expect(response.json?.code).toBe("WHATSAPP_OPT_IN_REQUIRED");

    expect(
      count(
        `select count(*) from public.messages
          where tenant_id = '${tenantA.tenantId}' and payload->>'receivable_id' = '${receivableId}';`,
      ),
    ).toBe(0);
  });

  it("PIX existente é reaproveitado e a cobrança WhatsApp entra na fila uma única vez", async () => {
    const asaasPaymentId = `pay-${randomUUID()}`;
    const receivableId = await seedReceivable(tenantA.tenantId, customerOptIn, {
      asaas_payment_id: asaasPaymentId,
      pix_qr_code: "qr-base64",
      pix_copy_paste: "00020126copia-cola",
    });

    const first = await callFunction("create-receivable-charge", {
      token: tenantA.admin.accessToken,
      body: { receivable_id: receivableId, notify_whatsapp: true },
    });
    expect(first.status).toBe(200);
    expect(first.json).toMatchObject({
      receivable_id: receivableId,
      reused: true,
      pix_copy_paste: "00020126copia-cola",
      whatsapp: { requested: true, queued: true },
    });

    const second = await callFunction("create-receivable-charge", {
      token: tenantA.admin.accessToken,
      body: { receivable_id: receivableId, notify_whatsapp: true },
    });
    expect(second.status).toBe(200);
    expect(second.json).toMatchObject({ whatsapp: { requested: true, queued: false } });

    const fila = count(
      `select count(*) from public.messages
        where tenant_id = '${tenantA.tenantId}'
          and payload->>'receivable_id' = '${receivableId}'
          and template = 'cobranca'
          and status = 'fila';`,
    );
    expect(fila).toBe(1);
  });

  it("gateway fechado: 422 GATEWAY_ERROR sem PIX e sem mensagem", async () => {
    const receivableId = await seedReceivable(tenantA.tenantId, customerOptIn);
    const response = await callFunction("create-receivable-charge", {
      token: tenantA.admin.accessToken,
      body: { receivable_id: receivableId, notify_whatsapp: true },
    });
    expect(response.status).toBe(422);
    expect(response.json?.code).toBe("GATEWAY_ERROR");

    const linha = sql(
      `select coalesce(jsonb_build_object('asaas', asaas_payment_id, 'pix', pix_copy_paste)::text, '{}')
         from public.receivables where id = '${receivableId}';`,
    );
    expect(JSON.parse(linha)).toEqual({ asaas: null, pix: null });
    expect(
      count(
        `select count(*) from public.messages
          where tenant_id = '${tenantA.tenantId}' and payload->>'receivable_id' = '${receivableId}';`,
      ),
    ).toBe(0);
  });

  it("conta parcial não gera novo PIX (PROTECAO CONTRA OVERPAY)", async () => {
    const receivableId = await seedReceivable(tenantA.tenantId, customerOptIn);
    await rpcAs(tenantA.admin, "receivable_settle", {
      p_receivable_id: receivableId,
      p_valor_cents: 2_000,
    });
    const response = await callFunction("create-receivable-charge", {
      token: tenantA.admin.accessToken,
      body: { receivable_id: receivableId },
    });
    expect(response.status).toBe(409);
    expect(response.json?.code).toBe("RECEIVABLE_CHARGE_NOT_PENDING");
  });
});
