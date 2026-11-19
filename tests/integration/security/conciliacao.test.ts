// Conciliação bancária (ADR-08; RF-22..26 + PRD §6.5/§7).
//
// Prova o contrato do ADR: import OFX/CSV replay-safe (hash), match valor exato
// ±2 dias, conciliação em lote atômica, criação de lançamento a partir da órfã,
// ignorar com motivo, undo de 5s com auditoria depois da janela e isolamento
// multi-tenant/admin-only. Nada aqui escreve em `appointment_payments`.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { serviceClient } from "../helpers/clients.ts";
import { callFunction } from "../helpers/functions.ts";
import {
  cleanupPaymentFixtures,
  createPaymentsTenant,
  ensureUnlimitedPlan,
  type PaymentsTenant,
} from "../helpers/payments-fixtures.ts";
import { sql } from "../helpers/sql.ts";
import { createTenantMember, deleteTestUsers, type TestUser } from "../helpers/users.ts";

let tenantA: PaymentsTenant;
let tenantB: PaymentsTenant;
/** Tenant no plano inicial (starter), SEM o entitlement `conciliacao`. */
let tenantC: PaymentsTenant;
let receptionist: TestUser;
let customerA: string;

const hoje = new Date();
/** Data (UTC, `yyyy-mm-dd`) deslocada em dias a partir de hoje. */
function isoDate(offsetDays = 0): string {
  const d = new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth(), hoje.getUTCDate()));
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

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

async function seedAccount(
  tenantId: string,
  over: Record<string, unknown> = {},
): Promise<string> {
  const { data, error } = await serviceClient()
    .from("bank_accounts")
    .insert({
      tenant_id: tenantId,
      nome: "Conta principal",
      banco: "Banco Teste",
      conta_ultimos4: String(Math.floor(1000 + Math.random() * 8999)),
      saldo_inicial_cents: 0,
      ...over,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`Fixture bank_account falhou (código ${error?.code ?? "vazio"}).`);
  return (data as { id: string }).id;
}

async function seedStatement(
  tenantId: string,
  accountId: string,
  periodo: { ini: string; fim: string },
): Promise<string> {
  const { data, error } = await serviceClient()
    .from("bank_statements")
    .insert({
      tenant_id: tenantId,
      account_id: accountId,
      formato: "csv",
      nome_arquivo: `extrato-${randomUUID().slice(0, 8)}.csv`,
      arquivo_hash: randomUUID().replace(/-/g, "").padEnd(64, "0").slice(0, 64),
      periodo_ini: periodo.ini,
      periodo_fim: periodo.fim,
      saldo_ini_cents: 0,
      saldo_fim_cents: 0,
      linhas_total: 0,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`Fixture bank_statement falhou (código ${error?.code ?? "vazio"}).`);
  return (data as { id: string }).id;
}

async function seedLine(
  tenantId: string,
  statementId: string,
  line: { data: string; valor_cents: number; descricao?: string },
): Promise<string> {
  const { data, error } = await serviceClient()
    .from("bank_lines")
    .insert({
      tenant_id: tenantId,
      statement_id: statementId,
      data: line.data,
      descricao: line.descricao ?? `Lançamento ${randomUUID().slice(0, 6)}`,
      valor_cents: line.valor_cents,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`Fixture bank_line falhou (código ${error?.code ?? "vazio"}).`);
  return (data as { id: string }).id;
}

async function seedPayable(
  tenantId: string,
  over: Record<string, unknown> = {},
): Promise<string> {
  const { data, error } = await serviceClient()
    .from("payables")
    .insert({
      tenant_id: tenantId,
      descricao: "Fornecedor do mês",
      categoria: "fixo",
      vencimento_at: `${isoDate(0)}T00:00:00.000Z`,
      valor_cents: 15_000,
      status: "pendente",
      ...over,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`Fixture payable falhou (código ${error?.code ?? "vazio"}).`);
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
      descricao: "Avulsa conciliável",
      categoria: "avulsa",
      vencimento_at: `${isoDate(0)}T00:00:00.000Z`,
      valor_cents: 20_000,
      status: "pendente",
      ...over,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`Fixture receivable falhou (código ${error?.code ?? "vazio"}).`);
  return (data as { id: string }).id;
}

async function seedCustomer(tenantId: string, name: string): Promise<string> {
  const { data, error } = await serviceClient()
    .from("customers")
    .insert({ tenant_id: tenantId, name, phone: "11987654321" })
    .select("id")
    .single();
  if (error || !data) throw new Error(`Fixture customer falhou (código ${error?.code ?? "vazio"}).`);
  return (data as { id: string }).id;
}

function lineStatus(lineId: string): string {
  return sql(`select status from public.bank_lines where id = '${lineId}';`);
}

function linksCount(lineId: string): number {
  return count(`select count(*) from public.reconciliation_links where bank_line_id = '${lineId}';`);
}

function auditCount(targetId: string, action: string): number {
  return count(
    `select count(*) from public.audit_log where target_id = '${targetId}' and action = '${action}';`,
  );
}

const OFX = `OFXHEADER:100
DATA:OFXSGML

<OFX>
<BANKMSGSRSV1>
<STMTTRNRS>
<STMTRS>
<BANKTRANLIST>
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20260105120000[-3:BRT]
<TRNAMT>-150.00
<MEMO>Pagamento fornecedor
</STMTTRN>
<STMTTRN>
<TRNTYPE>CREDIT
<DTPOSTED>20260110
<TRNAMT>1234.56
<NAME>Recebimento PIX
</STMTTRN>
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20260112
<TRNAMT>-89.90
<MEMO>Tarifa bancária
</STMTTRN>
</BANKTRANLIST>
<LEDGERBAL>
<BALAMT>994.66
<DTASOF>20260131
</LEDGERBAL>
</STMTRS>
</STMTTRNRS>
</BANKMSGSRSV1>
</OFX>`;

const CSV = `data;descricao;valor
05/02/2026;Pagamento fornecedor;-150,00
10/02/2026;Recebimento PIX;1.234,56`;

beforeAll(async () => {
  tenantA = await createPaymentsTenant("conciliacao-a");
  tenantB = await createPaymentsTenant("conciliacao-b");
  // `conciliacao` vive em premium/enterprise: A e B sobem para enterprise pela
  // RPC auditada (nunca desabilitando trigger). C fica no starter para o gate.
  await ensureUnlimitedPlan(tenantA.tenantId);
  await ensureUnlimitedPlan(tenantB.tenantId);
  tenantC = await createPaymentsTenant("conciliacao-c");
  receptionist = await createTenantMember(tenantA.tenantId, "receptionist", "conciliacao-reception");
  customerA = await seedCustomer(tenantA.tenantId, "Cliente conciliação");
});

afterAll(async () => {
  const admin = serviceClient();
  const tenants = [tenantA.tenantId, tenantB.tenantId, tenantC.tenantId];
  // Settlements são append-only: a limpeza do ambiente de teste desabilita o
  // trigger temporariamente (mesmo padrão de payables.test.ts) e reabilita no fim.
  sql("alter table public.payable_settlements disable trigger payable_settlements_no_update_delete;");
  sql("alter table public.receivable_settlements disable trigger receivable_settlements_no_update_delete;");
  try {
    // Ordem das FKs restrict: vínculos → extratos (leva linhas) → contas →
    // baixas → lançamentos.
    for (const table of [
      "reconciliation_links",
      "bank_statements",
      "bank_accounts",
      "payable_settlements",
      "receivable_settlements",
      "payables",
      "receivables",
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

describe("schema e RLS das tabelas de conciliação", () => {
  it("4 tabelas existem com dinheiro em *_cents, datas e índices únicos do ADR", () => {
    for (const table of ["bank_accounts", "bank_statements", "bank_lines", "reconciliation_links"]) {
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
          where table_schema = 'public' and table_name = 'bank_lines'
            and column_name in ('valor_cents','data');`,
      ),
    ).toBe("data:date,valor_cents:integer");

    expect(
      sql(
        `select string_agg(column_name || ':' || data_type, ',' order by column_name)
           from information_schema.columns
          where table_schema = 'public' and table_name = 'bank_statements'
            and column_name in ('periodo_ini','periodo_fim','arquivo_hash');`,
      ),
    ).toBe("arquivo_hash:text,periodo_fim:date,periodo_ini:date");

    for (const index of [
      "bank_statements_tenant_hash_uidx",
      "reconciliation_links_tenant_line_uidx",
      "reconciliation_links_tenant_alvo_uidx",
      "payables_tenant_valor_vencimento_idx",
      "receivables_tenant_valor_vencimento_idx",
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

  it("RLS on com uma única policy de select admin por tabela", () => {
    for (const table of ["bank_accounts", "bank_statements", "bank_lines", "reconciliation_links"]) {
      expect(
        count(
          `select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public' and c.relname = '${table}' and c.relrowsecurity;`,
        ),
        table,
      ).toBe(1);
      expect(
        sql(
          `select string_agg(policyname || ':' || cmd, ',' order by policyname)
             from pg_policies where schemaname = 'public' and tablename = '${table}';`,
        ),
        table,
      ).toBe(`${table}_select_tenant_admin:SELECT`);
    }
  });

  it("ignorar sem motivo é recusado pelo banco (CHECK)", async () => {
    const statement = await seedStatement(tenantA.tenantId, await seedAccount(tenantA.tenantId), {
      ini: isoDate(-1),
      fim: isoDate(1),
    });
    const { error } = await serviceClient()
      .from("bank_lines")
      .insert({
        tenant_id: tenantA.tenantId,
        statement_id: statement,
        data: isoDate(0),
        descricao: "Ignorada sem motivo",
        valor_cents: -100,
        status: "ignorado",
      });
    expect(error?.code).toBe("23514");
  });
});

describe("RF-22 importação OFX/CSV (Edge import-statement)", () => {
  it("OFX válido grava 1 extrato com 3 linhas, período e saldo final", async () => {
    const account = await seedAccount(tenantA.tenantId, { conta_ultimos4: "1111" });
    const response = await callFunction("import-statement", {
      token: tenantA.admin.accessToken,
      body: {
        account_id: account,
        formato: "ofx",
        nome_arquivo: "extrato-janeiro.ofx",
        conteudo: OFX,
      },
    });
    expect(response.status).toBe(200);
    expect(response.json).toMatchObject({
      linhas_total: 3,
      periodo_ini: "2026-01-05",
      periodo_fim: "2026-01-12",
      saldo_fim_cents: 99_466,
      replayed: false,
    });

    const statementId = response.json?.statement_id as string;
    expect(
      count(
        `select count(*) from public.bank_lines
          where tenant_id = '${tenantA.tenantId}' and statement_id = '${statementId}';`,
      ),
    ).toBe(3);
    expect(
      sql(
        `select valor_cents::text from public.bank_lines
          where statement_id = '${statementId}' and descricao = 'Pagamento fornecedor';`,
      ),
    ).toBe("-15000");
  });

  it("replay do MESMO arquivo não duplica extrato nem linhas", async () => {
    const account = await seedAccount(tenantA.tenantId, { conta_ultimos4: "2222" });
    const body = {
      account_id: account,
      formato: "csv",
      nome_arquivo: "extrato-fevereiro.csv",
      conteudo: CSV,
    };

    const first = await callFunction("import-statement", {
      token: tenantA.admin.accessToken,
      body,
    });
    expect(first.status).toBe(200);
    expect(first.json).toMatchObject({ linhas_total: 2, replayed: false });
    const statementId = first.json?.statement_id as string;

    const replay = await callFunction("import-statement", {
      token: tenantA.admin.accessToken,
      body,
    });
    expect(replay.status).toBe(200);
    expect(replay.json).toMatchObject({ statement_id: statementId, replayed: true });

    expect(
      count(
        `select count(*) from public.bank_statements where tenant_id = '${tenantA.tenantId}'
           and arquivo_hash = (select arquivo_hash from public.bank_statements where id = '${statementId}');`,
      ),
    ).toBe(1);
    expect(
      count(`select count(*) from public.bank_lines where statement_id = '${statementId}';`),
    ).toBe(2);
  });

  it("arquivo inválido → 422 legível e ZERO extrato/linha", async () => {
    const account = await seedAccount(tenantA.tenantId, { conta_ultimos4: "3333" });
    const antes = count(
      `select count(*) from public.bank_statements where tenant_id = '${tenantA.tenantId}';`,
    );

    const response = await callFunction("import-statement", {
      token: tenantA.admin.accessToken,
      body: {
        account_id: account,
        formato: "csv",
        nome_arquivo: "quebrado.csv",
        conteudo: "data;descricao;valor\nontem;Linha ruim;10,00",
      },
    });
    expect(response.status).toBe(422);
    expect(response.json?.code).toBe("STATEMENT_INVALID_DATE");
    expect(typeof response.json?.message).toBe("string");
    expect(
      count(`select count(*) from public.bank_statements where tenant_id = '${tenantA.tenantId}';`),
    ).toBe(antes);
  });

  it("recepção não importa (403); cliente não executa a RPC do import", async () => {
    const account = await seedAccount(tenantA.tenantId, { conta_ultimos4: "4444" });
    const denied = await callFunction("import-statement", {
      token: receptionist.accessToken,
      body: {
        account_id: account,
        formato: "csv",
        nome_arquivo: "extrato.csv",
        conteudo: CSV,
      },
    });
    expect(denied.status).toBe(403);

    const direct = await tenantA.admin.client.rpc("reconciliation_statement_create", {
      p_tenant_id: tenantA.tenantId,
      p_account_id: account,
      p_formato: "csv",
      p_nome_arquivo: "x.csv",
      p_arquivo_hash: "a".repeat(64),
      p_periodo_ini: isoDate(-1),
      p_periodo_fim: isoDate(1),
      p_saldo_ini_cents: 0,
      p_saldo_fim_cents: 0,
      p_linhas: [{ data: isoDate(0), descricao: "X", valor_cents: 100 }],
    });
    expect(direct.error?.code).toBe("42501");
  });
});

describe("RF-23 match (valor exato + janela de 2 dias)", () => {
  it("débito sugere payable de mesmo valor até ±2d, ordenado por proximidade", async () => {
    const account = await seedAccount(tenantA.tenantId, { conta_ultimos4: "5555" });
    const statement = await seedStatement(tenantA.tenantId, account, {
      ini: isoDate(-5),
      fim: isoDate(5),
    });
    const line = await seedLine(tenantA.tenantId, statement, {
      data: isoDate(0),
      valor_cents: -15_000,
      descricao: "PAGTO FORNECEDOR",
    });

    const exato = await seedPayable(tenantA.tenantId, {
      vencimento_at: `${isoDate(0)}T00:00:00.000Z`,
    });
    const doisDias = await seedPayable(tenantA.tenantId, {
      vencimento_at: `${isoDate(2)}T00:00:00.000Z`,
    });
    await seedPayable(tenantA.tenantId, { vencimento_at: `${isoDate(3)}T00:00:00.000Z` });
    await seedPayable(tenantA.tenantId, {
      vencimento_at: `${isoDate(0)}T00:00:00.000Z`,
      valor_cents: 15_001,
    });

    const { data, code } = await rpcAs(tenantA.admin, "reconciliation_suggest_matches", {
      p_bank_line_id: line,
    });
    expect(code).toBeUndefined();
    const payload = data as {
      tolerancia_dias: number;
      candidatos: Array<{ alvo_tipo: string; alvo_id: string; delta_dias: number; score: number }>;
    };
    expect(payload.tolerancia_dias).toBe(2);
    expect(payload.candidatos.map((c) => c.alvo_id)).toEqual([exato, doisDias]);
    expect(payload.candidatos[0]?.delta_dias).toBe(0);
    expect(payload.candidatos[0]?.score).toBe(100);
    expect(payload.candidatos[1]?.score).toBe(80);
    expect(payload.candidatos.every((c) => c.alvo_tipo === "payable")).toBe(true);
  });

  it("crédito sugere receivable; cancelado e alvo já vinculado ficam de fora", async () => {
    const account = await seedAccount(tenantA.tenantId, { conta_ultimos4: "6666" });
    const statement = await seedStatement(tenantA.tenantId, account, {
      ini: isoDate(-3),
      fim: isoDate(3),
    });
    const line = await seedLine(tenantA.tenantId, statement, {
      data: isoDate(0),
      valor_cents: 20_000,
    });
    const outro = await seedLine(tenantA.tenantId, statement, {
      data: isoDate(1),
      valor_cents: 20_000,
    });

    const disponivel = await seedReceivable(tenantA.tenantId, customerA);
    await seedReceivable(tenantA.tenantId, customerA, { status: "cancelado" });
    const jaVinculado = await seedReceivable(tenantA.tenantId, customerA);

    // Vincula um alvo à OUTRA linha e prova que ele sai da sugestão.
    await rpcAs(tenantA.admin, "reconciliation_link", {
      p_links: [{ bank_line_id: outro, alvo_tipo: "receivable", alvo_id: jaVinculado }],
    });

    const { data } = await rpcAs(tenantA.admin, "reconciliation_suggest_matches", {
      p_bank_line_id: line,
    });
    const candidatos = (data as { candidatos: Array<{ alvo_id: string }> }).candidatos;
    expect(candidatos.map((c) => c.alvo_id)).toEqual([disponivel]);
  });

  it("recepção não sugere (PT403)", async () => {
    const account = await seedAccount(tenantA.tenantId, { conta_ultimos4: "7777" });
    const statement = await seedStatement(tenantA.tenantId, account, {
      ini: isoDate(-1),
      fim: isoDate(1),
    });
    const line = await seedLine(tenantA.tenantId, statement, { data: isoDate(0), valor_cents: -500 });
    const denied = await rpcAs(receptionist, "reconciliation_suggest_matches", {
      p_bank_line_id: line,
    });
    expect(denied.code).toBe("PT403");
  });

  it("ordena ANTES do limite: 12 payables de mesmo valor mantêm o Δ=0 entre os 10", async () => {
    const account = await seedAccount(tenantA.tenantId, { conta_ultimos4: "2323" });
    const statement = await seedStatement(tenantA.tenantId, account, {
      ini: isoDate(-3),
      fim: isoDate(3),
    });
    const line = await seedLine(tenantA.tenantId, statement, { data: isoDate(0), valor_cents: -13_000 });

    // 11 lançamentos a +2 dias (inseridos primeiro) + 1 exato (inserido por último).
    for (let i = 0; i < 11; i += 1) {
      await seedPayable(tenantA.tenantId, {
        valor_cents: 13_000,
        vencimento_at: `${isoDate(2)}T00:00:00.000Z`,
      });
    }
    const exato = await seedPayable(tenantA.tenantId, {
      valor_cents: 13_000,
      vencimento_at: `${isoDate(0)}T00:00:00.000Z`,
    });

    const { data } = await rpcAs(tenantA.admin, "reconciliation_suggest_matches", {
      p_bank_line_id: line,
    });
    const candidatos = (data as { candidatos: Array<{ alvo_id: string; delta_dias: number }> })
      .candidatos;
    expect(candidatos).toHaveLength(10);
    expect(candidatos[0]).toMatchObject({ alvo_id: exato, delta_dias: 0 });
  });

  it("alvo já quitado (pago) não é sugerido; parcial segue elegível", async () => {
    const account = await seedAccount(tenantA.tenantId, { conta_ultimos4: "2424" });
    const statement = await seedStatement(tenantA.tenantId, account, {
      ini: isoDate(-2),
      fim: isoDate(2),
    });
    const debito = await seedLine(tenantA.tenantId, statement, {
      data: isoDate(0),
      valor_cents: -17_000,
    });
    const credito = await seedLine(tenantA.tenantId, statement, {
      data: isoDate(0),
      valor_cents: 21_000,
    });

    await seedPayable(tenantA.tenantId, { valor_cents: 17_000, status: "pago" });
    const parcial = await seedPayable(tenantA.tenantId, { valor_cents: 17_000, status: "parcial" });
    await seedReceivable(tenantA.tenantId, customerA, { valor_cents: 21_000, status: "pago" });
    const recebivel = await seedReceivable(tenantA.tenantId, customerA, { valor_cents: 21_000 });

    const pagar = await rpcAs(tenantA.admin, "reconciliation_suggest_matches", {
      p_bank_line_id: debito,
    });
    expect((pagar.data as { candidatos: Array<{ alvo_id: string }> }).candidatos.map((c) => c.alvo_id)).toEqual([
      parcial,
    ]);

    const receber = await rpcAs(tenantA.admin, "reconciliation_suggest_matches", {
      p_bank_line_id: credito,
    });
    expect(
      (receber.data as { candidatos: Array<{ alvo_id: string }> }).candidatos.map((c) => c.alvo_id),
    ).toEqual([recebivel]);
  });
});

describe("RF-24 conciliar, criar lançamento e ignorar", () => {
  it("lote concilia N linhas e audita cada uma", async () => {
    const account = await seedAccount(tenantA.tenantId, { conta_ultimos4: "8888" });
    const statement = await seedStatement(tenantA.tenantId, account, {
      ini: isoDate(-2),
      fim: isoDate(2),
    });
    const line1 = await seedLine(tenantA.tenantId, statement, { data: isoDate(0), valor_cents: -10_000 });
    const line2 = await seedLine(tenantA.tenantId, statement, { data: isoDate(1), valor_cents: 30_000 });
    const payable = await seedPayable(tenantA.tenantId, { valor_cents: 10_000 });
    const receivable = await seedReceivable(tenantA.tenantId, customerA, { valor_cents: 30_000 });

    const result = await rpcAs(tenantA.admin, "reconciliation_link", {
      p_links: [
        { bank_line_id: line1, alvo_tipo: "payable", alvo_id: payable },
        { bank_line_id: line2, alvo_tipo: "receivable", alvo_id: receivable },
      ],
    });
    expect(result.code).toBeUndefined();
    expect(result.data).toMatchObject({ linked: 2 });
    expect((result.data as { link_ids: string[] }).link_ids).toHaveLength(2);

    expect(lineStatus(line1)).toBe("conciliado");
    expect(lineStatus(line2)).toBe("conciliado");
    expect(linksCount(line1)).toBe(1);
    expect(auditCount(line1, "reconciliation_linked")).toBe(1);
    expect(auditCount(line2, "reconciliation_linked")).toBe(1);
  });

  it("lote é atômico: item inválido desfaz o lote inteiro", async () => {
    const account = await seedAccount(tenantA.tenantId, { conta_ultimos4: "9999" });
    const statement = await seedStatement(tenantA.tenantId, account, {
      ini: isoDate(-2),
      fim: isoDate(2),
    });
    const line1 = await seedLine(tenantA.tenantId, statement, { data: isoDate(0), valor_cents: -7_000 });
    const line2 = await seedLine(tenantA.tenantId, statement, { data: isoDate(1), valor_cents: -8_000 });
    const payable = await seedPayable(tenantA.tenantId, { valor_cents: 7_000 });
    const outroValor = await seedPayable(tenantA.tenantId, { valor_cents: 9_000 });

    const result = await rpcAs(tenantA.admin, "reconciliation_link", {
      p_links: [
        { bank_line_id: line1, alvo_tipo: "payable", alvo_id: payable },
        { bank_line_id: line2, alvo_tipo: "payable", alvo_id: outroValor },
      ],
    });
    expect(result.code).toBe("PT409");
    expect(result.message).toBe("RECONCILIATION_VALUE_MISMATCH");
    expect(lineStatus(line1)).toBe("pendente");
    expect(linksCount(line1)).toBe(0);
  });

  it("linha já conciliada, alvo já usado e alvo de outro tenant são recusados", async () => {
    const account = await seedAccount(tenantA.tenantId, { conta_ultimos4: "1212" });
    const statement = await seedStatement(tenantA.tenantId, account, {
      ini: isoDate(-2),
      fim: isoDate(2),
    });
    const line1 = await seedLine(tenantA.tenantId, statement, { data: isoDate(0), valor_cents: -4_000 });
    const line2 = await seedLine(tenantA.tenantId, statement, { data: isoDate(1), valor_cents: -4_000 });
    const payable = await seedPayable(tenantA.tenantId, { valor_cents: 4_000 });

    const ok = await rpcAs(tenantA.admin, "reconciliation_link", {
      p_links: [{ bank_line_id: line1, alvo_tipo: "payable", alvo_id: payable }],
    });
    expect(ok.code).toBeUndefined();

    const repetida = await rpcAs(tenantA.admin, "reconciliation_link", {
      p_links: [{ bank_line_id: line1, alvo_tipo: "payable", alvo_id: payable }],
    });
    expect(repetida.code).toBe("PT409");
    expect(repetida.message).toBe("RECONCILIATION_ALREADY_LINKED");

    const alvoUsado = await rpcAs(tenantA.admin, "reconciliation_link", {
      p_links: [{ bank_line_id: line2, alvo_tipo: "payable", alvo_id: payable }],
    });
    expect(alvoUsado.code).toBe("PT409");
    expect(alvoUsado.message).toBe("RECONCILIATION_TARGET_ALREADY_LINKED");

    const cross = await seedPayable(tenantB.tenantId, { valor_cents: 4_000 });
    const cruzado = await rpcAs(tenantA.admin, "reconciliation_link", {
      p_links: [{ bank_line_id: line2, alvo_tipo: "payable", alvo_id: cross }],
    });
    expect(cruzado.code).toBe("PT404");
    expect(cruzado.message).toBe("RECONCILIATION_TARGET_NOT_FOUND");
  });

  it("criar lançamento a partir da órfã: débito vira payable e crédito vira receivable", async () => {
    const account = await seedAccount(tenantA.tenantId, { conta_ultimos4: "1313" });
    const statement = await seedStatement(tenantA.tenantId, account, {
      ini: isoDate(-2),
      fim: isoDate(2),
    });
    const debito = await seedLine(tenantA.tenantId, statement, {
      data: isoDate(-1),
      valor_cents: -12_345,
      descricao: "COMPRA MATERIAL",
    });
    const credito = await seedLine(tenantA.tenantId, statement, {
      data: isoDate(0),
      valor_cents: 22_000,
      descricao: "SERVICO AVULSO",
    });

    const semCliente = await rpcAs(tenantA.admin, "reconciliation_create_entry", {
      p_bank_line_id: credito,
    });
    expect(semCliente.code).toBe("PT400");
    expect(semCliente.message).toBe("CUSTOMER_REQUIRED");

    const pagar = await rpcAs(tenantA.admin, "reconciliation_create_entry", {
      p_bank_line_id: debito,
      p_categoria: "material",
    });
    expect(pagar.code).toBeUndefined();
    const payableId = (pagar.data as { alvo_id: string }).alvo_id;
    expect(pagar.data).toMatchObject({ alvo_tipo: "payable", status: "conciliado" });
    expect(
      sql(
        `select valor_cents::text || '|' || (vencimento_at at time zone 'UTC')::date::text
           from public.payables where id = '${payableId}';`,
      ),
    ).toBe(`12345|${isoDate(-1)}`);
    // Nasce QUITADO na mesma transação: baixa com a data da linha + status pago.
    expect(sql(`select status from public.payables where id = '${payableId}';`)).toBe("pago");
    expect(
      sql(
        `select valor_cents::text || '|' || (pago_at at time zone 'UTC')::date::text
           from public.payable_settlements where payable_id = '${payableId}';`,
      ),
    ).toBe(`12345|${isoDate(-1)}`);
    expect(lineStatus(debito)).toBe("conciliado");

    const receber = await rpcAs(tenantA.admin, "reconciliation_create_entry", {
      p_bank_line_id: credito,
      p_customer_id: customerA,
    });
    expect(receber.code).toBeUndefined();
    expect(receber.data).toMatchObject({ alvo_tipo: "receivable", status: "conciliado" });
    const receivableId = (receber.data as { alvo_id: string }).alvo_id;
    expect(sql(`select status from public.receivables where id = '${receivableId}';`)).toBe("pago");
    expect(
      count(
        `select count(*) from public.receivable_settlements where receivable_id = '${receivableId}';`,
      ),
    ).toBe(1);
    expect(lineStatus(credito)).toBe("conciliado");

    const novamente = await rpcAs(tenantA.admin, "reconciliation_create_entry", {
      p_bank_line_id: credito,
      p_customer_id: customerA,
    });
    expect(novamente.code).toBe("PT409");
  });

  it("ignorar exige motivo (≥3); linha conciliada não é ignorada", async () => {
    const account = await seedAccount(tenantA.tenantId, { conta_ultimos4: "1414" });
    const statement = await seedStatement(tenantA.tenantId, account, {
      ini: isoDate(-2),
      fim: isoDate(2),
    });
    const ignoravel = await seedLine(tenantA.tenantId, statement, { data: isoDate(0), valor_cents: -300 });
    const conciliada = await seedLine(tenantA.tenantId, statement, { data: isoDate(1), valor_cents: -500 });
    const payable = await seedPayable(tenantA.tenantId, { valor_cents: 500 });
    await rpcAs(tenantA.admin, "reconciliation_link", {
      p_links: [{ bank_line_id: conciliada, alvo_tipo: "payable", alvo_id: payable }],
    });

    const semMotivo = await rpcAs(tenantA.admin, "reconciliation_ignore", {
      p_bank_line_ids: [ignoravel],
      p_motivo: "x",
    });
    expect(semMotivo.code).toBe("PT400");

    const ok = await rpcAs(tenantA.admin, "reconciliation_ignore", {
      p_bank_line_ids: [ignoravel],
      p_motivo: "Tarifa já lançada manualmente",
    });
    expect(ok.code).toBeUndefined();
    expect(ok.data).toMatchObject({ ignored: 1 });
    expect(
      sql(
        `select status || '|' || motivo_ignorado from public.bank_lines where id = '${ignoravel}';`,
      ),
    ).toBe("ignorado|Tarifa já lançada manualmente");
    expect(auditCount(ignoravel, "reconciliation_ignored")).toBe(1);

    const conciliadaIgnorada = await rpcAs(tenantA.admin, "reconciliation_ignore", {
      p_bank_line_ids: [conciliada],
      p_motivo: "Tentativa",
    });
    expect(conciliadaIgnorada.code).toBe("PT409");
    expect(conciliadaIgnorada.message).toBe("RECONCILIATION_LINE_RECONCILED");
  });

  it("vínculo manual exige motivo legível e audita o motivo", async () => {
    const account = await seedAccount(tenantA.tenantId, { conta_ultimos4: "2525" });
    const statement = await seedStatement(tenantA.tenantId, account, {
      ini: isoDate(-1),
      fim: isoDate(1),
    });
    const line = await seedLine(tenantA.tenantId, statement, { data: isoDate(0), valor_cents: -400 });

    const semMotivo = await rpcAs(tenantA.admin, "reconciliation_link", {
      p_links: [{ bank_line_id: line, alvo_tipo: "manual", alvo_id: null }],
    });
    expect(semMotivo.code).toBe("PT400");
    expect(lineStatus(line)).toBe("pendente");

    const curto = await rpcAs(tenantA.admin, "reconciliation_link", {
      p_links: [{ bank_line_id: line, alvo_tipo: "manual", alvo_id: null, motivo: "x" }],
    });
    expect(curto.code).toBe("PT400");

    const ok = await rpcAs(tenantA.admin, "reconciliation_link", {
      p_links: [
        {
          bank_line_id: line,
          alvo_tipo: "manual",
          alvo_id: null,
          motivo: "Tarifa sem lançamento no sistema",
        },
      ],
    });
    expect(ok.code).toBeUndefined();
    expect(ok.data).toMatchObject({ linked: 1 });
    expect(
      sql(`select alvo_tipo || '|' || motivo from public.reconciliation_links where bank_line_id = '${line}';`),
    ).toBe("manual|Tarifa sem lançamento no sistema");
    expect(
      sql(
        `select metadata->>'motivo' from public.audit_log
          where target_id = '${line}' and action = 'reconciliation_linked';`,
      ),
    ).toBe("Tarifa sem lançamento no sistema");
  });

  it("recepção não concilia, não cria lançamento e não ignora (PT403)", async () => {
    const account = await seedAccount(tenantA.tenantId, { conta_ultimos4: "1515" });
    const statement = await seedStatement(tenantA.tenantId, account, {
      ini: isoDate(-1),
      fim: isoDate(1),
    });
    const line = await seedLine(tenantA.tenantId, statement, { data: isoDate(0), valor_cents: -900 });

    for (const call of [
      () => rpcAs(receptionist, "reconciliation_link", {
        p_links: [
          { bank_line_id: line, alvo_tipo: "manual", alvo_id: null, motivo: "Tentativa" },
        ],
      }),
      () => rpcAs(receptionist, "reconciliation_create_entry", { p_bank_line_id: line }),
      () => rpcAs(receptionist, "reconciliation_ignore", {
        p_bank_line_ids: [line],
        p_motivo: "Tentativa",
      }),
    ]) {
      const denied = await call();
      expect(denied.code).toBe("PT403");
    }
    expect(lineStatus(line)).toBe("pendente");
  });
});

describe("RF-25 undo 5s + undo auditado depois da janela", () => {
  async function linkNewLine(): Promise<{ line: string; link: string; payable: string }> {
    const account = await seedAccount(tenantA.tenantId, {
      conta_ultimos4: String(Math.floor(1000 + Math.random() * 8999)),
    });
    const statement = await seedStatement(tenantA.tenantId, account, {
      ini: isoDate(-1),
      fim: isoDate(1),
    });
    const line = await seedLine(tenantA.tenantId, statement, { data: isoDate(0), valor_cents: -6_000 });
    const payable = await seedPayable(tenantA.tenantId, { valor_cents: 6_000 });
    const linked = await rpcAs(tenantA.admin, "reconciliation_link", {
      p_links: [{ bank_line_id: line, alvo_tipo: "payable", alvo_id: payable }],
    });
    expect(linked.code).toBeUndefined();
    const link = (linked.data as { link_ids: string[] }).link_ids[0] as string;
    return { line, link, payable };
  }

  it("dentro de 5s desfaz sem motivo e audita", async () => {
    const { line, link } = await linkNewLine();
    const undo = await rpcAs(tenantA.admin, "reconciliation_undo", { p_link_id: link });
    expect(undo.code).toBeUndefined();
    expect(undo.data).toMatchObject({ bank_line_id: line, undone: true, dentro_da_janela: true });
    expect(lineStatus(line)).toBe("pendente");
    expect(linksCount(line)).toBe(0);
    expect(auditCount(line, "reconciliation_undo")).toBe(1);
  });

  it("depois da janela exige motivo; com motivo audita", async () => {
    const { line, link } = await linkNewLine();
    // Envelhece o vínculo: a janela é de 5s a partir de `created_at`.
    sql(
      `update public.reconciliation_links set created_at = now() - interval '10 seconds'
        where id = '${link}';`,
    );

    const semMotivo = await rpcAs(tenantA.admin, "reconciliation_undo", { p_link_id: link });
    expect(semMotivo.code).toBe("PT400");
    expect(semMotivo.message).toBe("UNDO_REASON_REQUIRED");
    expect(lineStatus(line)).toBe("conciliado");

    const comMotivo = await rpcAs(tenantA.admin, "reconciliation_undo", {
      p_link_id: link,
      p_motivo: "Lancei no fornecedor errado",
    });
    expect(comMotivo.code).toBeUndefined();
    expect(comMotivo.data).toMatchObject({ dentro_da_janela: false });
    expect(lineStatus(line)).toBe("pendente");
    expect(auditCount(line, "reconciliation_undo_audited")).toBe(1);
  });

  it("vínculo criado junto do lançamento não aceita undo (evita órfão)", async () => {
    const account = await seedAccount(tenantA.tenantId, { conta_ultimos4: "1616" });
    const statement = await seedStatement(tenantA.tenantId, account, {
      ini: isoDate(-1),
      fim: isoDate(1),
    });
    const line = await seedLine(tenantA.tenantId, statement, { data: isoDate(0), valor_cents: -2_500 });
    const created = await rpcAs(tenantA.admin, "reconciliation_create_entry", {
      p_bank_line_id: line,
    });
    const link = (created.data as { link_id: string }).link_id;

    const undo = await rpcAs(tenantA.admin, "reconciliation_undo", { p_link_id: link });
    expect(undo.code).toBe("PT409");
    expect(undo.message).toBe("RECONCILIATION_ENTRY_UNDO_FORBIDDEN");
    expect(lineStatus(line)).toBe("conciliado");
  });

  it("recepção não desfaz (PT403)", async () => {
    const { link } = await linkNewLine();
    const denied = await rpcAs(receptionist, "reconciliation_undo", { p_link_id: link });
    expect(denied.code).toBe("PT403");
  });
});

describe("RF-26 gating/RLS: admin-only e isolamento por tenant", () => {
  it("admin A lê só o próprio tenant; recepção/profissional leem zero; escrita direta falha", async () => {
    const accountA = await seedAccount(tenantA.tenantId, { conta_ultimos4: "1717" });
    const statementA = await seedStatement(tenantA.tenantId, accountA, {
      ini: isoDate(-1),
      fim: isoDate(1),
    });
    await seedLine(tenantA.tenantId, statementA, { data: isoDate(0), valor_cents: -100 });

    const accountB = await seedAccount(tenantB.tenantId, { conta_ultimos4: "1818" });
    const statementB = await seedStatement(tenantB.tenantId, accountB, {
      ini: isoDate(-1),
      fim: isoDate(1),
    });
    await seedLine(tenantB.tenantId, statementB, { data: isoDate(0), valor_cents: -200 });

    const viewA = await tenantA.admin.client.from("bank_lines").select("id, tenant_id");
    expect(viewA.error).toBeNull();
    expect((viewA.data ?? []).length).toBeGreaterThanOrEqual(1);
    for (const row of viewA.data ?? []) expect(row.tenant_id).toBe(tenantA.tenantId);

    const viewB = await tenantB.admin.client.from("bank_accounts").select("id, tenant_id");
    expect(viewB.error).toBeNull();
    for (const row of viewB.data ?? []) expect(row.tenant_id).toBe(tenantB.tenantId);

    const recepcao = await receptionist.client.from("bank_lines").select("id");
    expect(recepcao.error).toBeNull();
    expect(recepcao.data ?? []).toHaveLength(0);

    for (const table of ["bank_accounts", "bank_statements", "bank_lines", "reconciliation_links"]) {
      const insert = await tenantA.admin.client.from(table).insert({
        tenant_id: tenantA.tenantId,
        ...(table === "bank_accounts"
          ? { nome: "X", banco: "Y", conta_ultimos4: "0000" }
          : table === "bank_statements"
            ? {
                account_id: accountA,
                formato: "csv",
                nome_arquivo: "x.csv",
                arquivo_hash: "b".repeat(64),
                periodo_ini: isoDate(0),
                periodo_fim: isoDate(0),
              }
            : table === "bank_lines"
              ? {
                  statement_id: statementA,
                  data: isoDate(0),
                  descricao: "x",
                  valor_cents: 1,
                }
              : { bank_line_id: randomUUID(), alvo_tipo: "manual" }),
      });
      expect(insert.error?.code, `${table} insert`).toBe("42501");
    }
  });

  it("conta de outro tenant é PT404 no import e no vínculo", async () => {
    const accountB = await seedAccount(tenantB.tenantId, { conta_ultimos4: "1919" });
    const response = await callFunction("import-statement", {
      token: tenantA.admin.accessToken,
      body: {
        account_id: accountB,
        formato: "csv",
        nome_arquivo: "extrato.csv",
        conteudo: CSV,
      },
    });
    expect(response.status).toBe(404);
    expect(response.json?.code).toBe("BANK_ACCOUNT_NOT_FOUND");

    const accountA = await seedAccount(tenantA.tenantId, { conta_ultimos4: "2020" });
    const statementA = await seedStatement(tenantA.tenantId, accountA, {
      ini: isoDate(-1),
      fim: isoDate(1),
    });
    const lineA = await seedLine(tenantA.tenantId, statementA, { data: isoDate(0), valor_cents: -100 });

    const crossLine = await rpcAs(tenantB.admin, "reconciliation_link", {
      p_links: [
        { bank_line_id: lineA, alvo_tipo: "manual", alvo_id: null, motivo: "Conferência cruzada" },
      ],
    });
    expect(crossLine.code).toBe("PT404");
    expect(crossLine.message).toBe("BANK_LINE_NOT_FOUND");
  });

  it("contas: criação idempotente por banco+últimos 4 e conta completa nunca é guardada", async () => {
    const primeira = await rpcAs(tenantA.admin, "reconciliation_account_create", {
      p_nome: "Conta PJ",
      p_banco: "Banco Único",
      p_conta_ultimos4: "4321",
      p_saldo_inicial_cents: 1_000,
    });
    expect(primeira.code).toBeUndefined();
    const accountId = (primeira.data as { account_id: string }).account_id;
    expect(primeira.data).toMatchObject({ replayed: false });

    const replay = await rpcAs(tenantA.admin, "reconciliation_account_create", {
      p_nome: "Nome alterado",
      p_banco: "Banco Único",
      p_conta_ultimos4: "4321",
    });
    expect(replay.data).toMatchObject({ account_id: accountId, replayed: true });

    const invalida = await rpcAs(tenantA.admin, "reconciliation_account_create", {
      p_nome: "Conta",
      p_banco: "Banco",
      p_conta_ultimos4: "123456",
    });
    expect(invalida.code).toBe("PT400");

    const denied = await rpcAs(receptionist, "reconciliation_account_create", {
      p_nome: "Conta",
      p_banco: "Banco",
      p_conta_ultimos4: "5555",
    });
    expect(denied.code).toBe("PT403");

    expect(
      sql(
        `select string_agg(column_name, ',' order by column_name)
           from information_schema.columns
          where table_schema = 'public' and table_name = 'bank_accounts'
            and column_name in ('conta_ultimos4','agencia','conta','numero_conta');`,
      ),
    ).toBe("conta_ultimos4");
  });

  it("plano sem `conciliacao`: RPCs mutantes e import recusam com FEATURE_DISABLED", async () => {
    // Tenant C está no starter: entitlement ausente. Sem upgrade de propósito.
    const accountId = await seedAccount(tenantC.tenantId, { conta_ultimos4: "2727" });
    const statementC = await seedStatement(tenantC.tenantId, accountId, {
      ini: isoDate(-1),
      fim: isoDate(1),
    });
    const lineC = await seedLine(tenantC.tenantId, statementC, {
      data: isoDate(0),
      valor_cents: -600,
    });

    const conta = await rpcAs(tenantC.admin, "reconciliation_account_create", {
      p_nome: "Conta bloqueada",
      p_banco: "Banco",
      p_conta_ultimos4: "0001",
    });
    expect(conta.code).toBe("PT403");
    expect(conta.message).toBe("FEATURE_DISABLED");

    const vinculo = await rpcAs(tenantC.admin, "reconciliation_link", {
      p_links: [
        { bank_line_id: lineC, alvo_tipo: "manual", alvo_id: null, motivo: "Conferência" },
      ],
    });
    expect(vinculo.code).toBe("PT403");
    expect(vinculo.message).toBe("FEATURE_DISABLED");

    const entrada = await rpcAs(tenantC.admin, "reconciliation_create_entry", {
      p_bank_line_id: lineC,
    });
    expect(entrada.code).toBe("PT403");
    expect(entrada.message).toBe("FEATURE_DISABLED");

    const ignorar = await rpcAs(tenantC.admin, "reconciliation_ignore", {
      p_bank_line_ids: [lineC],
      p_motivo: "Tentativa",
    });
    expect(ignorar.code).toBe("PT403");
    expect(ignorar.message).toBe("FEATURE_DISABLED");

    const edge = await callFunction("import-statement", {
      token: tenantC.admin.accessToken,
      body: {
        account_id: accountId,
        formato: "csv",
        nome_arquivo: "extrato.csv",
        conteudo: CSV,
      },
    });
    expect(edge.status).toBe(403);
    expect(edge.json?.code).toBe("FEATURE_DISABLED");

    expect(lineStatus(lineC)).toBe("pendente");
    expect(count(`select count(*) from public.bank_statements where tenant_id = '${tenantC.tenantId}';`)).toBe(1);
    expect(count(`select count(*) from public.reconciliation_links where tenant_id = '${tenantC.tenantId}';`)).toBe(0);
  });
});

describe("Fronteira do ledger (SSoT intocado)", () => {
  it("conciliação não cria/edita appointment_payments e não vincula atendimento", () => {
    expect(
      count(
        `select count(*) from information_schema.columns
          where table_schema = 'public' and table_name in ('bank_lines','reconciliation_links')
            and column_name = 'appointment_id';`,
      ),
    ).toBe(0);

    const account = sql(
      `select id from public.bank_accounts where tenant_id = '${tenantB.tenantId}' limit 1;`,
    );
    expect(account.length).toBeGreaterThan(0);
  });
});
