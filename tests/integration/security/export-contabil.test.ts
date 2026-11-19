// Export contábil (ADR-10; RF-36..38 + PRD §6.8/§7).
//
// Prova o contrato do ADR: CSV receber (ledger + avulsas), CSV pagar (baixas),
// CSV fiscal (NFC-e), OFX do extrato conciliado com saldo, SPED-resumo com
// total igual ao DRE (caixa), período vazio (422, sem arquivo e sem log de
// sucesso), RBAC admin-only, gating `export_contabil`, RLS da trilha e
// isolamento multi-tenant. Nada aqui escreve no ledger de atendimento.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { callFunction } from "../helpers/functions.ts";
import { serviceClient } from "../helpers/clients.ts";
import {
  cleanupPaymentFixtures,
  createPaymentsTenant,
  ensureUnlimitedPlan,
  seedAppointment,
  type PaymentsTenant,
} from "../helpers/payments-fixtures.ts";
import { sql } from "../helpers/sql.ts";
import { createTenantMember, deleteTestUsers, type TestUser } from "../helpers/users.ts";

let tenantA: PaymentsTenant;
let tenantB: PaymentsTenant;
/** Tenant no plano inicial (starter), SEM o entitlement `export_contabil`. */
let tenantC: PaymentsTenant;
let receptionist: TestUser;

const PERIODO = { ini: "2026-01-01", fim: "2026-01-31" };
/** Meia-noite local (BRT) de 01/01/2026 e 01/02/2026. */
const INI = "2026-01-01T03:00:00.000Z";
const FIM = "2026-02-01T03:00:00.000Z";

function count(query: string): number {
  return Number(sql(query));
}

function must(label: string, result: { data: unknown; error: { code?: string } | null }): any {
  if (result.error || result.data === null) {
    throw new Error(`Fixture ${label} falhou (código ${result.error?.code ?? "vazio"}).`);
  }
  return result.data;
}

function body(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    periodo_ini: PERIODO.ini,
    periodo_fim: PERIODO.fim,
    ini: INI,
    fim: FIM,
    formato: "csv",
    escopo: "receber",
    ...over,
  };
}

async function exportar(
  token: string,
  over: Record<string, unknown> = {},
): Promise<{ status: number; text: string; json: Record<string, unknown> | null }> {
  return await callFunction("export-ledger", { method: "POST", token, body: body(over) });
}

async function seedCustomer(tenantId: string, name: string): Promise<string> {
  return must(
    "customer",
    await serviceClient()
      .from("customers")
      .insert({ tenant_id: tenantId, name, phone: "11987654321" })
      .select("id")
      .single(),
  ).id as string;
}

/** Cria atendimento concluído com `starts_at` no alvo e o recebimento no período. */
async function seedAtendimentoRecebido(
  tenantId: string,
  amountCents: number,
  startsAt: string,
  receivedAt: string,
): Promise<string> {
  const appointment = await seedAppointment(tenantId, { priceCents: amountCents, status: "concluido" });
  const starts = new Date(startsAt);
  const { error } = await serviceClient()
    .from("appointments")
    .update({
      starts_at: starts.toISOString(),
      ends_at: new Date(starts.getTime() + 30 * 60_000).toISOString(),
    })
    .eq("tenant_id", tenantId)
    .eq("id", appointment.appointmentId);
  if (error) throw new Error(`Ajuste de starts_at falhou (código ${error.code ?? "vazio"}).`);

  must(
    "appointment_payment",
    await serviceClient()
      .from("appointment_payments")
      .insert({
        tenant_id: tenantId,
        appointment_id: appointment.appointmentId,
        method: "pix_sistema",
        amount_cents: amountCents,
        source: "manual",
        received_at: receivedAt,
      })
      .select("id")
      .single(),
  );
  return appointment.appointmentId;
}

async function seedAvulsa(
  tenantId: string,
  customerId: string,
  valorCents: number,
  recebidoEm: string,
): Promise<string> {
  const receivableId = must(
    "receivable",
    await serviceClient()
      .from("receivables")
      .insert({
        tenant_id: tenantId,
        customer_id: customerId,
        descricao: "Pacote avulso",
        categoria: "avulsa",
        vencimento_at: recebidoEm,
        valor_cents: valorCents,
        status: "pago",
      })
      .select("id")
      .single(),
  ).id as string;

  must(
    "receivable_settlement",
    await serviceClient()
      .from("receivable_settlements")
      .insert({
        tenant_id: tenantId,
        receivable_id: receivableId,
        valor_cents: valorCents,
        recebido_at: recebidoEm,
        metodo: "pix",
      })
      .select("id")
      .single(),
  );
  return receivableId;
}

async function seedPayable(
  tenantId: string,
  valorCents: number,
  pagoEm: string,
): Promise<string> {
  const payableId = must(
    "payable",
    await serviceClient()
      .from("payables")
      .insert({
        tenant_id: tenantId,
        descricao: "Aluguel do salão",
        categoria: "aluguel",
        vencimento_at: pagoEm,
        valor_cents: valorCents,
        status: "pago",
      })
      .select("id")
      .single(),
  ).id as string;

  must(
    "payable_settlement",
    await serviceClient()
      .from("payable_settlements")
      .insert({
        tenant_id: tenantId,
        payable_id: payableId,
        valor_cents: valorCents,
        pago_at: pagoEm,
        conta: "Banco Teste",
      })
      .select("id")
      .single(),
  );
  return payableId;
}

/** Cobrança de membership paga (recorrência) — mesma base de caixa do DRE. */
async function seedMembership(
  tenantId: string,
  customerId: string,
  amountCents: number,
  paidAt: string,
): Promise<void> {
  const planId = must(
    "membership_plan",
    await serviceClient()
      .from("membership_plans")
      .insert({ tenant_id: tenantId, name: "Plano Ouro", amount_cents: amountCents, billing_period: "mensal" })
      .select("id")
      .single(),
  ).id as string;

  const subscriptionId = must(
    "membership_subscription",
    await serviceClient()
      .from("membership_subscriptions")
      .insert({ tenant_id: tenantId, customer_id: customerId, plan_id: planId, status: "ativa" })
      .select("id")
      .single(),
  ).id as string;

  must(
    "membership_charge",
    await serviceClient()
      .from("membership_charges")
      .insert({
        tenant_id: tenantId,
        subscription_id: subscriptionId,
        cycle_ref: "2026-01",
        amount_cents: amountCents,
        status: "pago",
        paid_at: paidAt,
      })
      .select("id")
      .single(),
  );
}

async function seedFiscal(tenantId: string): Promise<string> {  const doc = must(
    "fiscal_document",
    await serviceClient()
      .from("fiscal_documents")
      .insert({
        tenant_id: tenantId,
        origem_tipo: "sale",
        origem_id: randomUUID(),
        numero: "100",
        serie: "1",
        chave_acesso: "35260112345678000199650010000001001000001001",
        status: "autorizada",
        valor_cents: 5_000,
        xml: "<xml/>",
        authorized_at: "2026-01-10T15:00:00.000Z",
      })
      .select("id")
      .single(),
  ).id as string;
  return doc;
}

async function seedBank(tenantId: string): Promise<void> {
  const accountId = must(
    "bank_account",
    await serviceClient()
      .from("bank_accounts")
      .insert({
        tenant_id: tenantId,
        nome: "Conta principal",
        banco: "Banco Teste",
        conta_ultimos4: "4321",
        saldo_inicial_cents: 10_000,
      })
      .select("id")
      .single(),
  ).id as string;

  const statementId = must(
    "bank_statement",
    await serviceClient()
      .from("bank_statements")
      .insert({
        tenant_id: tenantId,
        account_id: accountId,
        formato: "ofx",
        nome_arquivo: "extrato-janeiro.ofx",
        arquivo_hash: randomUUID().replace(/-/g, "").padEnd(64, "0").slice(0, 64),
        periodo_ini: PERIODO.ini,
        periodo_fim: PERIODO.fim,
        saldo_ini_cents: 10_000,
        saldo_fim_cents: 15_000,
        linhas_total: 2,
      })
      .select("id")
      .single(),
  ).id as string;

  must(
    "bank_line conciliada",
    await serviceClient()
      .from("bank_lines")
      .insert({
        tenant_id: tenantId,
        statement_id: statementId,
        data: "2026-01-15",
        descricao: "PIX recebido conciliado",
        valor_cents: 5_000,
        status: "conciliado",
      })
      .select("id")
      .single(),
  );

  must(
    "bank_line pendente",
    await serviceClient()
      .from("bank_lines")
      .insert({
        tenant_id: tenantId,
        statement_id: statementId,
        data: "2026-01-16",
        descricao: "Linha pendente que não pode vazar",
        valor_cents: 9_999,
      })
      .select("id")
      .single(),
  );
}

beforeAll(async () => {
  tenantA = await createPaymentsTenant("exp-a");
  tenantB = await createPaymentsTenant("exp-b");
  await ensureUnlimitedPlan(tenantA.tenantId);
  await ensureUnlimitedPlan(tenantB.tenantId);
  tenantC = await createPaymentsTenant("exp-c");
  receptionist = await createTenantMember(tenantA.tenantId, "receptionist", "exp-recepcao");

  const customerA = await seedCustomer(tenantA.tenantId, "Cliente Export A");
  await seedAtendimentoRecebido(tenantA.tenantId, 20_000, "2026-01-10T15:00:00.000Z", "2026-01-12T15:00:00.000Z");
  await seedAvulsa(tenantA.tenantId, customerA, 7_000, "2026-01-16T12:00:00.000Z");
  await seedMembership(tenantA.tenantId, customerA, 3_000, "2026-01-20T12:00:00.000Z");
  await seedPayable(tenantA.tenantId, 4_000, "2026-01-26T12:00:00.000Z");
  await seedFiscal(tenantA.tenantId);
  await seedBank(tenantA.tenantId);
});

afterAll(async () => {
  const admin = serviceClient();
  const tenants = [tenantA.tenantId, tenantB.tenantId, tenantC.tenantId];
  sql("alter table public.payable_settlements disable trigger payable_settlements_no_update_delete;");
  sql("alter table public.receivable_settlements disable trigger receivable_settlements_no_update_delete;");
  try {
    for (const table of [
      "membership_charges",
      "membership_subscriptions",
      "membership_plans",
      "export_logs",
      "audit_log",
      "payable_settlements",
      "receivable_settlements",
      "payables",
      "receivables",
      "fiscal_documents",
      "bank_accounts",
    ] as const) {
      const { error } = await admin.from(table).delete().in("tenant_id", tenants);
      if (error) throw new Error(`Limpeza de ${table} falhou (código ${error.code ?? "sem código"}).`);
    }
  } finally {
    sql("alter table public.payable_settlements enable trigger payable_settlements_no_update_delete;");
    sql("alter table public.receivable_settlements enable trigger receivable_settlements_no_update_delete;");
  }
  await cleanupPaymentFixtures(tenants);
  await deleteTestUsers();
});

describe("schema e RLS da trilha (ADR-10)", () => {
  it("export_logs segue admin-only e não aceita insert direto do cliente", async () => {
    const insert = await tenantA.admin.client.from("export_logs").insert({
      tipo: "ledger",
      periodo: "2026-01-01..2026-01-31",
      formato: "csv",
      arquivo_path: "x.csv",
    });
    expect(insert.error).not.toBeNull();

    const rpc = await tenantA.admin.client.rpc("export_log_write", {
      p_tenant_id: tenantA.tenantId,
      p_tipo: "ledger",
      p_periodo: "2026-01-01..2026-01-31",
      p_formato: "csv",
      p_arquivo_path: "x.csv",
      p_actor_id: tenantA.admin.id,
    });
    expect(rpc.error).not.toBeNull();
  });
});

describe("CSV por escopo", () => {
  it("receber: ledger + avulsas, log do tenant do JWT", async () => {
    const response = await exportar(tenantA.admin.accessToken, { escopo: "receber" });
    expect(response.status).toBe(200);
    expect(response.text).toContain("Data;Tipo;Categoria;Descricao");
    expect(response.text).toContain("Cliente Export A");
    expect(response.text).toContain("20000;0;200,00");
    expect(response.text).toContain("7000;0;70,00");
    expect(response.text).toContain("Receitas avulsas");
    // Recorrência (membership) usa a categoria do DRE — paridade SPED/CSV ↔ DRE.
    expect(response.text).toContain("Recorrência");
    expect(response.text).toContain("3000;0;30,00");

    const logs = await tenantA.admin.client
      .from("export_logs")
      .select("id, tipo, periodo, formato, arquivo_path, created_by")
      .eq("tenant_id", tenantA.tenantId);
    expect(logs.error).toBeNull();
    expect(logs.data).toHaveLength(1);
    expect(logs.data?.[0]).toMatchObject({
      tipo: "ledger",
      periodo: "2026-01-01..2026-01-31",
      formato: "csv",
      arquivo_path: "export-receber-csv-2026-01-01_2026-01-31.csv",
      created_by: tenantA.admin.id,
    });
  });

  it("pagar: baixas do período e log tipo payables", async () => {
    const response = await exportar(tenantA.admin.accessToken, { escopo: "pagar" });
    expect(response.status).toBe(200);
    expect(response.text).toContain("Aluguel do salão");
    expect(response.text).toContain("4000;0;40,00");
    expect(response.text).toContain(";aluguel;");

    const log = sql(
      `select tipo from public.export_logs
        where tenant_id = '${tenantA.tenantId}' and tipo = 'payables' limit 1;`,
    );
    expect(log).toBe("payables");
  });

  it("fiscal: NFC-e do período e log tipo fiscal", async () => {
    const response = await exportar(tenantA.admin.accessToken, { formato: "csv", escopo: "fiscal" });
    expect(response.status).toBe(200);
    expect(response.text).toContain("NFC-e nº 100 série 1 — Autorizada");
    expect(response.text).toContain("5000;0;50,00");

    expect(
      count(
        `select count(*) from public.export_logs
          where tenant_id = '${tenantA.tenantId}' and tipo = 'fiscal';`,
      ),
    ).toBe(1);
  });
});

describe("OFX e SPED-resumo", () => {
  it("OFX: extrato conciliado, saldo de abertura e linha pendente fora", async () => {
    const response = await exportar(tenantA.admin.accessToken, { formato: "ofx" });
    expect(response.status).toBe(200);
    expect(response.text.startsWith("OFXHEADER:100")).toBe(true);
    expect(response.text).toContain("<ACCTID>4321</ACCTID>");
    expect(response.text).toContain("<MEMO>PIX recebido conciliado</MEMO>");
    expect(response.text.includes("Linha pendente que não pode vazar")).toBe(false);
    // saldo inicial 100,00 + conciliado 50,00
    expect(response.text).toContain("<BALAMT>150.00</BALAMT>");

    expect(
      count(
        `select count(*) from public.export_logs
          where tenant_id = '${tenantA.tenantId}' and tipo = 'ofx';`,
      ),
    ).toBe(1);
  });

  it("SPED-resumo: total do bloco bate com o DRE caixa", async () => {
    const dre = await tenantA.admin.client.rpc("dre_report", {
      p_ini: INI,
      p_fim: FIM,
      p_regime: "caixa",
    });
    expect(dre.error).toBeNull();
    const report = dre.data as { receitas: { total_cents: number } };
    // Atendimentos 200,00 + avulsas 70,00 + recorrência 30,00.
    expect(report.receitas.total_cents).toBe(30_000);

    const response = await exportar(tenantA.admin.accessToken, { formato: "sped", escopo: "receber" });
    expect(response.status).toBe(200);
    expect(response.text).toContain("|E110|Atendimentos|200,00|1|");
    expect(response.text).toContain("|E110|Receitas avulsas|70,00|1|");
    expect(response.text).toContain("|E110|Recorrência|30,00|1|");
    expect(response.text).toContain("|E990|TOTAL|300,00|3|");

    const pagar = await exportar(tenantA.admin.accessToken, { formato: "sped", escopo: "pagar" });
    expect(pagar.status).toBe(200);
    expect(pagar.text).toContain("|E120|aluguel|40,00|1|");
  });
});

describe("período vazio, RBAC, gating e isolamento", () => {
  it("período vazio: 422, sem arquivo, sem log de sucesso e recusa auditada", async () => {
    const antes = count(
      `select count(*) from public.export_logs where tenant_id = '${tenantA.tenantId}';`,
    );

    const response = await exportar(tenantA.admin.accessToken, {
      periodo_ini: "2026-03-01",
      periodo_fim: "2026-03-31",
      ini: "2026-03-01T03:00:00.000Z",
      fim: "2026-04-01T03:00:00.000Z",
      escopo: "receber",
    });
    expect(response.status).toBe(422);
    expect(response.json?.code).toBe("EMPTY_PERIOD");

    const depois = count(
      `select count(*) from public.export_logs where tenant_id = '${tenantA.tenantId}';`,
    );
    expect(depois).toBe(antes);

    const recusas = count(
      `select count(*) from public.audit_log
        where tenant_id = '${tenantA.tenantId}'
          and action = 'export_rejected'
          and metadata->>'motivo' = 'EMPTY_PERIOD';`,
    );
    expect(recusas).toBeGreaterThanOrEqual(1);
  });

  it("recepção 403 sem log; plano sem export_contabil 403 FEATURE_DISABLED", async () => {
    const antes = count(
      `select count(*) from public.export_logs where tenant_id = '${tenantA.tenantId}';`,
    );
    const recepcao = await exportar(receptionist.accessToken, {});
    expect(recepcao.status).toBe(403);
    expect(recepcao.json?.code).toBe("FORBIDDEN");

    const semPlano = await exportar(tenantC.admin.accessToken, {});
    expect(semPlano.status).toBe(403);
    expect(semPlano.json?.code).toBe("FEATURE_DISABLED");

    expect(
      count(`select count(*) from public.export_logs where tenant_id = '${tenantA.tenantId}';`),
    ).toBe(antes);
    expect(
      count(`select count(*) from public.export_logs where tenant_id = '${tenantC.tenantId}';`),
    ).toBe(0);
  });

  it("RLS: cada tenant vê só a própria trilha; recepção não vê nenhuma", async () => {
    const logsA = await tenantA.admin.client.from("export_logs").select("id");
    expect(logsA.error).toBeNull();
    expect(logsA.data?.length ?? 0).toBeGreaterThan(0);

    const logsB = await tenantB.admin.client.from("export_logs").select("id");
    expect(logsB.error).toBeNull();
    expect(logsB.data).toHaveLength(0);

    const logsRecepcao = await receptionist.client.from("export_logs").select("id");
    expect(logsRecepcao.error).toBeNull();
    expect(logsRecepcao.data).toHaveLength(0);

    // B exporta o próprio período vazio: nunca herda movimentos de A.
    const b = await exportar(tenantB.admin.accessToken, { escopo: "receber" });
    expect(b.status).toBe(422);
    expect(b.json?.code).toBe("EMPTY_PERIOD");
  });
});
