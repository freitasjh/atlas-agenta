// Edge `import-statement` (ADR-08, RF-22): fronteira HTTP do import.
//
// Cobre: admin-only, corpo inválido, conta de outro tenant, arquivo inválido
// (422 com código estável e ZERO chamada de escrita), import feliz com hash
// sha-256 e replay devolvido pela RPC, e log sem PII de extrato.
import { deepStrictEqual, strictEqual } from "node:assert/strict";
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { createHandler } from "./handler.ts";

type Row = Record<string, unknown>;

interface FakeState {
  profile: Row | null;
  account: Row | null;
  rpcReply: { data: unknown; error: unknown };
  rpcCalls: Array<{ name: string; args: Row }>;
  /** Entitlement `conciliacao` do tenant (gate server-side). */
  feature?: boolean;
}

function chain(terminal: () => Promise<{ data: unknown; error: unknown }>) {
  const node: any = {
    select: () => node,
    eq: () => node,
    order: () => node,
    limit: () => node,
    maybeSingle: terminal,
    single: terminal,
  };
  return node;
}

function fakeService(state: FakeState): SupabaseClient {
  return {
    auth: { getUser: async () => ({ data: { user: { id: "u1" } }, error: null }) },
    from: (table: string) => {
      if (table === "profiles") return chain(async () => ({ data: state.profile, error: null }));
      if (table === "bank_accounts") return chain(async () => ({ data: state.account, error: null }));
      return chain(async () => ({ data: null, error: null }));
    },
    rpc: async (name: string, args: Row) => {
      if (name === "tenant_has_feature") {
        return { data: state.feature ?? true, error: null };
      }
      state.rpcCalls.push({ name, args });
      return state.rpcReply;
    },
  } as unknown as SupabaseClient;
}

function baseState(over: Partial<FakeState> = {}): FakeState {
  return {
    profile: { tenant_id: "t1", role: "admin", active: true },
    account: { id: "a1" },
    rpcReply: {
      data: {
        statement_id: "s1",
        linhas_total: 2,
        periodo_ini: "2026-01-05",
        periodo_fim: "2026-01-10",
        saldo_ini_cents: null,
        saldo_fim_cents: 108_456,
        replayed: false,
      },
      error: null,
    },
    rpcCalls: [],
    ...over,
  };
}

const CSV = `data;descricao;valor
05/01/2026;Pagamento fornecedor;-150,00
10/01/2026;Recebimento PIX;1.234,56`;

function request(body: unknown, token: string | null = "jwt"): Request {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token !== null) headers.Authorization = `Bearer ${token}`;
  return new Request("http://localhost/functions/v1/import-statement", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

function bodyAccount(over: Row = {}): Row {
  return {
    account_id: "9f9e1a0e-1111-4111-8111-111111111111",
    formato: "csv",
    nome_arquivo: "extrato-janeiro.csv",
    conteudo: CSV,
    ...over,
  };
}

async function call(state: FakeState, req: Request): Promise<{ status: number; json: Row | null }> {
  const handler = createHandler({ createService: () => fakeService(state) });
  const response = await handler(req);
  const text = await response.text();
  return { status: response.status, json: text === "" ? null : (JSON.parse(text) as Row) };
}

Deno.test("OPTIONS 200 sem service; GET 405; config ausente 500", async () => {
  const state = baseState();
  const handler = createHandler({ createService: () => fakeService(state) });
  const options = await handler(new Request("http://x/import-statement", { method: "OPTIONS" }));
  strictEqual(options.status, 200);

  const get = await handler(new Request("http://x/import-statement", { method: "GET" }));
  strictEqual(get.status, 405);
  strictEqual(((await get.json()) as Row).code, "METHOD_NOT_ALLOWED");

  const broken = createHandler({
    createService: () => {
      throw new Error("config");
    },
  });
  const failed = await broken(request(bodyAccount()));
  strictEqual(failed.status, 500);
});

Deno.test("sem token 401; recepção 403", async () => {
  const semToken = await call(baseState(), request(bodyAccount(), null));
  strictEqual(semToken.status, 401);

  const state = baseState({ profile: { tenant_id: "t1", role: "receptionist", active: true } });
  const recepcao = await call(state, request(bodyAccount()));
  strictEqual(recepcao.status, 403);
  strictEqual(recepcao.json?.code, "FORBIDDEN");
  strictEqual(state.rpcCalls.length, 0);
});

Deno.test("corpo inválido 400; conta inexistente 404 sem escrita", async () => {
  const invalido = await call(baseState(), request({ formato: "csv" }));
  strictEqual(invalido.status, 400);
  strictEqual(invalido.json?.code, "INVALID_BODY");

  const state = baseState({ account: null });
  const semConta = await call(state, request(bodyAccount()));
  strictEqual(semConta.status, 404);
  strictEqual(semConta.json?.code, "BANK_ACCOUNT_NOT_FOUND");
  strictEqual(state.rpcCalls.length, 0);
});

Deno.test("arquivo inválido 422 com código legível e ZERO escrita", async () => {
  const state = baseState();
  const result = await call(
    state,
    request(bodyAccount({ conteudo: "data;descricao;valor\nxx;Y;1,00" })),
  );
  strictEqual(result.status, 422);
  strictEqual(result.json?.code, "STATEMENT_INVALID_DATE");
  strictEqual(typeof result.json?.message, "string");
  strictEqual(state.rpcCalls.length, 0);
});

Deno.test("import feliz: tenant do JWT, linhas normalizadas, hash e log sem PII", async () => {
  const state = baseState();
  const logs: string[] = [];
  const originalLog = console.log;
  console.log = (...args: unknown[]) => {
    logs.push(args.map(String).join(" "));
  };
  try {
    const result = await call(state, request(bodyAccount()));
    strictEqual(result.status, 200);
    deepStrictEqual(result.json, {
      statement_id: "s1",
      linhas_total: 2,
      periodo_ini: "2026-01-05",
      periodo_fim: "2026-01-10",
      saldo_ini_cents: null,
      saldo_fim_cents: 108_456,
      replayed: false,
    });

    strictEqual(state.rpcCalls.length, 1);
    const rpc = state.rpcCalls[0]!;
    strictEqual(rpc.name, "reconciliation_statement_create");
    strictEqual(rpc.args.p_tenant_id, "t1");
    strictEqual(rpc.args.p_importado_por, "u1");
    strictEqual(rpc.args.p_formato, "csv");
    strictEqual((rpc.args.p_arquivo_hash as string).length, 64);
    deepStrictEqual(rpc.args.p_linhas, [
      { data: "2026-01-05", descricao: "Pagamento fornecedor", valor_cents: -15_000 },
      { data: "2026-01-10", descricao: "Recebimento PIX", valor_cents: 123_456 },
    ]);

    const joined = logs.join("\n");
    strictEqual(joined.includes("Pagamento fornecedor"), false);
    strictEqual(joined.includes("Recebimento PIX"), false);
    strictEqual(joined.includes("statement_imported"), true);
  } finally {
    console.log = originalLog;
  }
});

Deno.test("replay: RPC devolve o statement existente e a Edge propaga", async () => {
  const state = baseState({
    rpcReply: {
      data: {
        statement_id: "s1",
        linhas_total: 2,
        periodo_ini: "2026-01-05",
        periodo_fim: "2026-01-10",
        saldo_ini_cents: null,
        saldo_fim_cents: 108_456,
        replayed: true,
      },
      error: null,
    },
  });
  const result = await call(state, request(bodyAccount()));
  strictEqual(result.status, 200);
  strictEqual(result.json?.replayed, true);
});

Deno.test("sem entitlement `conciliacao` 403 FEATURE_DISABLED sem escrita", async () => {
  const state = baseState({ feature: false });
  const result = await call(state, request(bodyAccount()));
  strictEqual(result.status, 403);
  strictEqual(result.json?.code, "FEATURE_DISABLED");
  strictEqual(state.rpcCalls.length, 0);
});

Deno.test("erro de domínio da RPC vira HTTP 422; falha de infra vira 500 sem SQL", async () => {
  const dominio = await call(
    baseState({ rpcReply: { data: null, error: { code: "PT422", message: "STATEMENT_EMPTY" } } }),
    request(bodyAccount()),
  );
  strictEqual(dominio.status, 422);
  strictEqual(dominio.json?.code, "STATEMENT_EMPTY");

  const infra = await call(
    baseState({
      rpcReply: { data: null, error: { code: "XX000", message: "relation does not exist" } },
    }),
    request(bodyAccount()),
  );
  strictEqual(infra.status, 500);
  strictEqual(infra.json?.code, "INTERNAL");
  strictEqual(JSON.stringify(infra.json).includes("relation"), false);
});
