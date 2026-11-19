// Edge `export-ledger` (ADR-10, RF-36..38): fronteira HTTP do export.
//
// Cobre: admin-only, entitlement, corpo inválido, CSV montado do ledger +
// avulsas com sanitização de fórmula, OFX com saldo, período vazio (422 sem
// arquivo e sem log de sucesso), range excessivo e falha de log (500 sem
// arquivo — entrega nunca existe sem prova).
import { deepStrictEqual, strictEqual } from "node:assert/strict";
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { createHandler, exportFileName, exportLogTipo } from "./handler.ts";

type Row = Record<string, unknown>;

interface FakeState {
  profile: Row | null;
  feature?: boolean;
  tables: Record<string, unknown>;
  rpcCalls: Array<{ name: string; args: Row }>;
  writeReply?: { data: unknown; error: unknown };
  rejectReply?: { data: unknown; error: unknown };
}

function builder(state: FakeState, table: string) {
  const filters: Array<{ op: "gte" | "lt" | "lte"; column: string; value: string }> = [];
  let rangeFrom = 0;
  let rangeTo = Number.MAX_SAFE_INTEGER;
  const applyFilters = (rows: Row[]): Row[] =>
    rows.filter((row) =>
      filters.every((filter) => {
        const raw = row[filter.column];
        if (typeof raw !== "string") return true;
        if (filter.op === "gte") return raw >= filter.value;
        if (filter.op === "lte") return raw <= filter.value;
        return raw < filter.value;
      }),
    );
  const result = () => {
    const base =
      table === "profiles"
        ? state.profile === null
          ? []
          : [state.profile]
        : (state.tables[table] ?? []);
    const rows = Array.isArray(base) ? (base as Row[]) : base === null ? [] : [base as Row];
    return { data: applyFilters(rows).slice(rangeFrom, rangeTo + 1), error: null };
  };
  // deno-lint-ignore no-explicit-any
  const node: any = {
    select: () => node,
    eq: () => node,
    is: () => node,
    not: () => node,
    or: () => node,
    gte: (column: string, value: string) => {
      filters.push({ op: "gte", column, value });
      return node;
    },
    lt: (column: string, value: string) => {
      filters.push({ op: "lt", column, value });
      return node;
    },
    lte: (column: string, value: string) => {
      filters.push({ op: "lte", column, value });
      return node;
    },
    in: () => node,
    order: () => node,
    limit: () => node,
    range: (from: number, to: number) => {
      rangeFrom = from;
      rangeTo = to;
      return node;
    },
    maybeSingle: async () => {
      const { data } = result();
      return { data: Array.isArray(data) ? (data[0] ?? null) : data, error: null };
    },
    single: async () => {
      const { data } = result();
      return { data: Array.isArray(data) ? (data[0] ?? null) : data, error: null };
    },
    then: (resolve: (value: unknown) => unknown) => Promise.resolve(result()).then(resolve),
  };
  return node;
}

function fakeService(state: FakeState): SupabaseClient {
  return {
    auth: { getUser: async () => ({ data: { user: { id: "u1" } }, error: null }) },
    from: (table: string) => builder(state, table),
    rpc: async (name: string, args: Row) => {
      if (name === "tenant_has_feature") {
        return { data: state.feature ?? true, error: null };
      }
      state.rpcCalls.push({ name, args });
      if (name === "export_log_write") {
        return state.writeReply ?? { data: { id: "log-1" }, error: null };
      }
      if (name === "export_log_reject") {
        return state.rejectReply ?? { data: { rejected: true }, error: null };
      }
      return { data: null, error: null };
    },
  } as unknown as SupabaseClient;
}

function baseState(over: Partial<FakeState> = {}): FakeState {
  return {
    profile: { tenant_id: "t1", role: "admin", active: true },
    tables: { tenants: [{ timezone: "America/Sao_Paulo" }] },
    rpcCalls: [],
    ...over,
  };
}

const INI = "2026-01-01T03:00:00.000Z";
const FIM = "2026-02-01T03:00:00.000Z";

function body(over: Row = {}): Row {
  return {
    periodo_ini: "2026-01-01",
    periodo_fim: "2026-01-31",
    ini: INI,
    fim: FIM,
    formato: "csv",
    escopo: "receber",
    ...over,
  };
}

function request(payload: unknown, token: string | null = "jwt"): Request {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token !== null) headers.Authorization = `Bearer ${token}`;
  return new Request("http://localhost/functions/v1/export-ledger", {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });
}

async function call(state: FakeState, req: Request): Promise<Response> {
  const handler = createHandler({ createService: () => fakeService(state) });
  return await handler(req);
}

async function json(response: Response): Promise<Row> {
  return (await response.json()) as Row;
}

Deno.test("OPTIONS 200; GET 405; config ausente 500", async () => {
  const handler = createHandler({ createService: () => fakeService(baseState()) });
  strictEqual((await handler(new Request("http://x", { method: "OPTIONS" }))).status, 200);

  const get = await handler(new Request("http://x", { method: "GET" }));
  strictEqual(get.status, 405);
  strictEqual((await json(get)).code, "METHOD_NOT_ALLOWED");

  const broken = createHandler({
    createService: () => {
      throw new Error("config");
    },
  });
  strictEqual((await broken(request(body()))).status, 500);
});

Deno.test("sem token 401; recepção 403; plano sem export_contabil 403 sem leitura", async () => {
  strictEqual((await call(baseState(), request(body(), null))).status, 401);

  const recepcao = baseState({ profile: { tenant_id: "t1", role: "receptionist", active: true } });
  const blockedRole = await call(recepcao, request(body()));
  strictEqual(blockedRole.status, 403);
  strictEqual((await json(blockedRole)).code, "FORBIDDEN");

  const semPlano = baseState({ feature: false });
  const blockedPlan = await call(semPlano, request(body()));
  strictEqual(blockedPlan.status, 403);
  strictEqual((await json(blockedPlan)).code, "FEATURE_DISABLED");
  strictEqual(semPlano.rpcCalls.length, 0);
});

Deno.test("corpo inválido 400; período invertido 400; range > 400 dias 400", async () => {
  strictEqual((await call(baseState(), request({ formato: "csv" }))).status, 400);

  const invertido = await call(baseState(), request(body({ periodo_fim: "2025-12-01" })));
  strictEqual(invertido.status, 400);
  strictEqual((await json(invertido)).code, "INVALID_BODY");

  const longo = await call(
    baseState(),
    request(body({ ini: "2024-01-01T03:00:00.000Z", fim: "2025-06-01T03:00:00.000Z" })),
  );
  strictEqual(longo.status, 400);
  strictEqual((await json(longo)).code, "RANGE_TOO_LARGE");
});

Deno.test("CSV receber: ledger + avulsas, fórmula neutralizada e log gravado", async () => {
  const state = baseState({
    tables: {
      tenants: [{ timezone: "America/Sao_Paulo" }],
      appointment_payments: [
        {
          id: "p1",
          appointment_id: "a1",
          amount_cents: 15_000,
          tip_cents: 1_000,
          method: "pix_sistema",
          received_at: "2026-01-05T14:00:00.000Z",
        },
      ],
      appointments: [{ id: "a1", customer_id: "c1" }],
      customers: [{ id: "c1", name: "Ana" }],
      receivable_settlements: [
        {
          id: "s1",
          receivable_id: "r1",
          valor_cents: 2_000,
          recebido_at: "2026-01-06T14:00:00.000Z",
          metodo: "pix",
        },
      ],
      receivables: [
        { id: "r1", descricao: "=golpe()", categoria: "avulsa", customer_id: "c2" },
      ],
    },
  });

  const response = await call(state, request(body()));
  strictEqual(response.status, 200);
  strictEqual(response.headers.get("Content-Type"), "text/csv; charset=utf-8");
  strictEqual(
    response.headers.get("Content-Disposition"),
    'attachment; filename="export-receber-csv-2026-01-01_2026-01-31.csv"',
  );
  strictEqual(response.headers.get("X-Export-Log-Id"), "log-1");

  const text = await response.text();
  strictEqual(text.startsWith("\uFEFF"), true);
  strictEqual(text.includes("Atendimento — Ana"), true);
  strictEqual(text.includes("'=golpe()"), true);
  strictEqual(text.includes("15000;1000;150,00"), true);
  strictEqual(text.includes("2000;0;20,00"), true);

  const write = state.rpcCalls.find((call) => call.name === "export_log_write");
  deepStrictEqual(write?.args, {
    p_tenant_id: "t1",
    p_tipo: "ledger",
    p_periodo: "2026-01-01..2026-01-31",
    p_formato: "csv",
    p_arquivo_path: "export-receber-csv-2026-01-01_2026-01-31.csv",
    p_actor_id: "u1",
    p_escopo: "receber",
  });
});

Deno.test("período vazio: 422 EMPTY_PERIOD, sem arquivo e sem log de sucesso", async () => {
  const state = baseState();
  const response = await call(state, request(body()));
  strictEqual(response.status, 422);
  strictEqual((await json(response)).code, "EMPTY_PERIOD");

  strictEqual(state.rpcCalls.some((call) => call.name === "export_log_write"), false);
  const reject = state.rpcCalls.find((call) => call.name === "export_log_reject");
  deepStrictEqual(reject?.args, {
    p_tenant_id: "t1",
    p_periodo: "2026-01-01..2026-01-31",
    p_formato: "csv",
    p_escopo: "receber",
    p_motivo: "EMPTY_PERIOD",
    p_actor_id: "u1",
  });
});

Deno.test("OFX: extrato conciliado com saldo de abertura", async () => {
  const state = baseState({
    tables: {
      tenants: [{ timezone: "America/Sao_Paulo" }],
      bank_accounts: [
        { id: "acc1", nome: "Principal", banco: "Banco Teste", conta_ultimos4: "1234", saldo_inicial_cents: 10_000 },
      ],
      bank_statements: [{ id: "st1", account_id: "acc1" }],
      bank_lines: [
        { id: "l1", statement_id: "st1", data: "2026-01-05", descricao: "PIX recebido", valor_cents: 5_000 },
      ],
    },
  });

  const response = await call(state, request(body({ formato: "ofx", escopo: "receber" })));
  strictEqual(response.status, 200);
  const text = await response.text();
  strictEqual(text.startsWith("OFXHEADER:100"), true);
  strictEqual(text.includes("<BALAMT>150.00</BALAMT>"), true);
  strictEqual(text.includes("<TRNAMT>50.00</TRNAMT>"), true);

  const write = state.rpcCalls.find((call) => call.name === "export_log_write");
  strictEqual(write?.args.p_tipo, "ofx");
  strictEqual(write?.args.p_formato, "ofx");
});

Deno.test("SPED pagar: bloco E120 e tipo `sped` no log", async () => {
  const state = baseState({
    tables: {
      tenants: [{ timezone: "America/Sao_Paulo" }],
      payable_settlements: [
        { id: "s1", payable_id: "pa1", valor_cents: 4_000, pago_at: "2026-01-10T12:00:00.000Z", conta: "Banco" },
      ],
      payables: [{ id: "pa1", descricao: "Aluguel", categoria: "aluguel", supplier_id: null }],
    },
  });

  const response = await call(state, request(body({ formato: "sped", escopo: "pagar" })));
  strictEqual(response.status, 200);
  const text = await response.text();
  strictEqual(text.includes("|E120|aluguel|40,00|1|"), true);
  const write = state.rpcCalls.find((call) => call.name === "export_log_write");
  strictEqual(write?.args.p_tipo, "sped");
});

Deno.test("falha ao gravar log: 500 sem arquivo", async () => {
  const state = baseState({
    tables: {
      tenants: [{ timezone: "America/Sao_Paulo" }],
      payable_settlements: [
        { id: "s1", payable_id: "pa1", valor_cents: 4_000, pago_at: "2026-01-10T12:00:00.000Z", conta: "" },
      ],
      payables: [{ id: "pa1", descricao: "Aluguel", categoria: "aluguel", supplier_id: null }],
    },
    writeReply: { data: null, error: { code: "XX000", message: "boom" } },
  });

  const response = await call(state, request(body({ formato: "csv", escopo: "pagar" })));
  strictEqual(response.status, 500);
  strictEqual((await json(response)).code, "INTERNAL");
});

Deno.test("nome do arquivo e tipo do log são estáveis", () => {
  strictEqual(exportFileName("sped", "fiscal", "2026-01-01", "2026-01-31"), "export-fiscal-sped-2026-01-01_2026-01-31.txt");
  strictEqual(exportLogTipo("csv", "pagar"), "payables");
  strictEqual(exportLogTipo("csv", "fiscal"), "fiscal");
  strictEqual(exportLogTipo("csv", "receber"), "ledger");
  strictEqual(exportLogTipo("sped", "receber"), "sped");
});

Deno.test("rótulo do período divergente das bordas: 400 sem log", async () => {
  const state = baseState({
    tables: {
      tenants: [{ timezone: "America/Sao_Paulo" }],
      payable_settlements: [
        { id: "s1", payable_id: "pa1", valor_cents: 4_000, pago_at: "2026-01-10T12:00:00.000Z", conta: "" },
      ],
      payables: [{ id: "pa1", descricao: "Aluguel", categoria: "aluguel", supplier_id: null }],
    },
  });

  // Bordas reais cobrem 01/01..02/01 (fim exclusivo), mas o rótulo diz 15/02.
  const response = await call(state, request(body({ periodo_fim: "2026-02-15", escopo: "pagar" })));
  strictEqual(response.status, 400);
  strictEqual((await json(response)).code, "INVALID_BODY");
  strictEqual(state.rpcCalls.some((call) => call.name === "export_log_write"), false);
});

Deno.test("CSV receber inclui recorrência (membership) na categoria do DRE", async () => {
  const state = baseState({
    tables: {
      tenants: [{ timezone: "America/Sao_Paulo" }],
      membership_charges: [
        {
          id: "m1",
          subscription_id: "sub1",
          amount_cents: 3_000,
          paid_at: "2026-01-20T12:00:00.000Z",
        },
      ],
      membership_subscriptions: [{ id: "sub1", plan_id: "plan1", customer_id: "c1" }],
      membership_plans: [{ id: "plan1", name: "Plano Ouro" }],
      customers: [{ id: "c1", name: "Ana" }],
    },
  });

  const response = await call(state, request(body()));
  strictEqual(response.status, 200);
  const text = await response.text();
  strictEqual(text.includes("Recorrência"), true);
  strictEqual(text.includes("Plano Ouro — Ana"), true);
  strictEqual(text.includes("3000;0;30,00"), true);
});

Deno.test("OFX com conta e zero movimentos é arquivo válido (não é período vazio)", async () => {
  const state = baseState({
    tables: {
      tenants: [{ timezone: "America/Sao_Paulo" }],
      bank_accounts: [
        { id: "acc1", nome: "Principal", banco: "Banco Teste", conta_ultimos4: "1234", saldo_inicial_cents: 10_000 },
      ],
      bank_lines: [],
    },
  });

  const response = await call(state, request(body({ formato: "ofx" })));
  strictEqual(response.status, 200);
  const text = await response.text();
  strictEqual(text.includes("<BALAMT>100.00</BALAMT>"), true);
});

Deno.test("OFX sem conta ativa: 422 EMPTY_PERIOD", async () => {
  const state = baseState();
  const response = await call(state, request(body({ formato: "ofx" })));
  strictEqual(response.status, 422);
  strictEqual((await json(response)).code, "EMPTY_PERIOD");
  strictEqual(state.rpcCalls.some((call) => call.name === "export_log_write"), false);
});

Deno.test("OFX ignora linhas de conta inativa (abertura e extrato)", async () => {
  const state = baseState({
    tables: {
      tenants: [{ timezone: "America/Sao_Paulo" }],
      bank_accounts: [
        { id: "acc1", nome: "Principal", banco: "Banco Teste", conta_ultimos4: "1234", saldo_inicial_cents: 10_000 },
      ],
      bank_statements: [
        { id: "st1", account_id: "acc1" },
        { id: "st2", account_id: "acc2" },
      ],
      bank_lines: [
        { id: "l1", statement_id: "st1", data: "2026-01-05", descricao: "Ativa", valor_cents: 5_000 },
        { id: "l2", statement_id: "st2", data: "2026-01-06", descricao: "Conta inativa", valor_cents: 7_000 },
      ],
    },
  });

  const response = await call(state, request(body({ formato: "ofx" })));
  strictEqual(response.status, 200);
  const text = await response.text();
  strictEqual(text.includes("<BALAMT>150.00</BALAMT>"), true);
  strictEqual(text.includes("Conta inativa"), false);
});
