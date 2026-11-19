// Cancelamento do PIX de conta avulsa (ADR-07, revisão 1).
//
// Guarda o caminho que desbloqueia `receivable_settle`/`receivable_cancel`: o PIX
// só some da conta quando o gateway confirma o cancelamento. Falha do gateway
// nunca limpa os campos locais (o QR continuaria pagável).
import { deepStrictEqual, strictEqual } from "node:assert/strict";
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { encryptText } from "../_shared/asaas.ts";
import { createHandler } from "./handler.ts";

Deno.env.set("ASAAS_MASTER_KEY", "segredo");
const ENCRYPTED_KEY = await encryptText("key");

type Row = Record<string, unknown>;

interface FakeState {
  profile: Row | null;
  receivable: Row | null;
  config: Row | null;
  cleared: boolean;
  statusAfterClear?: string;
  calls: string[];
  auditInserts: Row[];
}

function query(data: unknown): any {
  const node: any = {
    select: () => node,
    eq: () => node,
    maybeSingle: async () => ({ data, error: null }),
  };
  return node;
}

function fakeService(state: FakeState): SupabaseClient {
  return {
    auth: { getUser: async () => ({ data: { user: { id: "u1" } }, error: null }) },
    from: (table: string) => {
      if (table === "profiles") return query(state.profile);
      if (table === "receivables") return query(state.receivable);
      if (table === "tenant_asaas_config") return query(state.config);
      if (table === "audit_log") {
        return {
          insert: async (row: Row) => {
            state.auditInserts.push(row);
            return { error: null };
          },
        };
      }
      return query(null);
    },
    rpc: async (name: string) => {
      state.calls.push(`rpc:${name}`);
      if (name === "clear_receivable_gateway_data") {
        if (state.cleared) {
          state.receivable = {
            ...(state.receivable ?? {}),
            asaas_payment_id: null,
            pix_copy_paste: null,
          };
        } else if (state.statusAfterClear && state.receivable) {
          state.receivable = { ...state.receivable, status: state.statusAfterClear };
        }
        return { data: { cleared: state.cleared }, error: null };
      }
      return { data: null, error: null };
    },
  } as unknown as SupabaseClient;
}

function baseState(over: Partial<FakeState> = {}): FakeState {
  return {
    profile: { tenant_id: "t1", role: "admin", active: true },
    receivable: {
      id: "9f9e1a0e-1111-4111-8111-111111111111",
      status: "pendente",
      asaas_payment_id: "pay-live",
    },
    config: { active: true, environment: "sandbox", asaas_api_key_encrypted: ENCRYPTED_KEY },
    cleared: true,
    calls: [],
    auditInserts: [],
    ...over,
  };
}

function request(body: unknown, options: { method?: string; token?: string | null } = {}): Request {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (options.token !== null) headers.Authorization = `Bearer ${options.token ?? "jwt"}`;
  return new Request("http://localhost/functions/v1/cancel-receivable-charge", {
    method: options.method ?? "POST",
    headers,
    body: options.method === "GET" ? undefined : JSON.stringify(body),
  });
}

function stubAsaas(deleteStatus = 200) {
  const original = globalThis.fetch;
  const deletes: string[] = [];
  globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
    if (init?.method === "DELETE" && String(url).includes("/payments/")) {
      deletes.push(String(url));
      return new Response("{}", { status: deleteStatus });
    }
    return new Response("{}", { status: 200 });
  }) as typeof fetch;
  return {
    deletes,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

function handlerFor(state: FakeState, throwOnCreate = false) {
  return createHandler({
    createService: () => {
      if (throwOnCreate) throw new Error("config");
      return fakeService(state);
    },
  });
}

const RECEIVABLE_ID = "9f9e1a0e-1111-4111-8111-111111111111";

Deno.test("OPTIONS 200 sem service; GET 405; config ausente 500", async () => {
  let created = 0;
  const options = createHandler({
    createService: () => {
      created += 1;
      return fakeService(baseState());
    },
  });
  strictEqual((await options(request({}, { method: "OPTIONS" }))).status, 200);
  strictEqual(created, 0);
  strictEqual((await handlerFor(baseState())(request({}, { method: "GET" }))).status, 405);
  strictEqual((await handlerFor(baseState(), true)(request({}))).status, 500);
});

Deno.test("sem token 401; papel não-admin 403", async () => {
  strictEqual((await handlerFor(baseState())(request({}, { token: null }))).status, 401);
  const denied = await handlerFor(
    baseState({ profile: { tenant_id: "t1", role: "receptionist", active: true } }),
  )(request({ receivable_id: RECEIVABLE_ID }));
  strictEqual(denied.status, 403);
});

Deno.test("corpo inválido 400; conta inexistente 404; paga/cancelada 409", async () => {
  strictEqual((await handlerFor(baseState())(request({}))).status, 400);

  const missing = await handlerFor(baseState({ receivable: null }))(
    request({ receivable_id: RECEIVABLE_ID }),
  );
  strictEqual(missing.status, 404);

  for (const [status, code] of [
    ["pago", "RECEIVABLE_ALREADY_PAID"],
    ["cancelado", "RECEIVABLE_CANCELLED"],
  ] as const) {
    const response = await handlerFor(
      baseState({ receivable: { id: RECEIVABLE_ID, status, asaas_payment_id: "pay-live" } }),
    )(request({ receivable_id: RECEIVABLE_ID }));
    strictEqual(response.status, 409, status);
    strictEqual((await response.json()).code, code);
  }
});

Deno.test("conta sem PIX: 200 idempotente sem tocar o gateway", async () => {
  const stub = stubAsaas();
  const state = baseState({
    receivable: { id: RECEIVABLE_ID, status: "pendente", asaas_payment_id: null },
  });
  try {
    const response = await handlerFor(state)(request({ receivable_id: RECEIVABLE_ID }));
    strictEqual(response.status, 200);
    const body = await response.json();
    strictEqual(body.cancelled, false);
    strictEqual(body.status, "pendente");
    strictEqual(stub.deletes.length, 0);
    strictEqual(state.auditInserts.length, 0);
  } finally {
    stub.restore();
  }
});

Deno.test("PIX vivo: cancela no gateway, limpa a conta e audita", async () => {
  const stub = stubAsaas();
  const state = baseState();
  try {
    const response = await handlerFor(state)(request({ receivable_id: RECEIVABLE_ID }));
    strictEqual(response.status, 200);
    const body = await response.json();
    strictEqual(body.cancelled, true);
    deepStrictEqual(stub.deletes, ["https://sandbox.asaas.com/api/v3/payments/pay-live"]);
    strictEqual(state.calls.includes("rpc:clear_receivable_gateway_data"), true);
    strictEqual(state.receivable?.asaas_payment_id, null);
    strictEqual(state.auditInserts[0]?.action, "receivable_charge_cancelled");
  } finally {
    stub.restore();
  }
});

Deno.test("404 do gateway é 'já cancelado': limpa a conta mesmo assim", async () => {
  const stub = stubAsaas(404);
  const state = baseState();
  try {
    const response = await handlerFor(state)(request({ receivable_id: RECEIVABLE_ID }));
    strictEqual(response.status, 200);
    strictEqual((await response.json()).cancelled, true);
    strictEqual(state.receivable?.asaas_payment_id, null);
  } finally {
    stub.restore();
  }
});

Deno.test("gateway recusa o cancelamento: 422 e a conta mantém o PIX", async () => {
  const stub = stubAsaas(400);
  const state = baseState();
  try {
    const response = await handlerFor(state)(request({ receivable_id: RECEIVABLE_ID }));
    strictEqual(response.status, 422);
    strictEqual((await response.json()).code, "GATEWAY_CANCEL_FAILED");
    strictEqual(state.receivable?.asaas_payment_id, "pay-live");
    strictEqual(state.calls.includes("rpc:clear_receivable_gateway_data"), false);
    strictEqual(state.auditInserts.length, 0);
  } finally {
    stub.restore();
  }
});

Deno.test("conta mudou durante o cancelamento: 409 sem limpar nada", async () => {
  const stub = stubAsaas();
  const state = baseState({ cleared: false, statusAfterClear: "pago" });
  try {
    const response = await handlerFor(state)(request({ receivable_id: RECEIVABLE_ID }));
    strictEqual(response.status, 409);
    strictEqual((await response.json()).code, "RECEIVABLE_ALREADY_PAID");
    strictEqual(state.auditInserts.length, 0);
  } finally {
    stub.restore();
  }
});

Deno.test("Asaas não configurado: 422 antes de qualquer chamada", async () => {
  const stub = stubAsaas();
  const state = baseState({ config: null });
  try {
    const response = await handlerFor(state)(request({ receivable_id: RECEIVABLE_ID }));
    strictEqual(response.status, 422);
    strictEqual((await response.json()).code, "ASAAS_NOT_CONFIGURED");
    strictEqual(stub.deletes.length, 0);
  } finally {
    stub.restore();
  }
});
