// Cobrança PIX de conta avulsa (ADR-07, revisão 1).
//
// Cobre o contrato que a revisão exigiu: claim serializa a criação (≤1 POST
// /payments), o perdedor NUNCA cancela o PIX do vencedor, PIX expirado é
// cancelado e reemitido, opt-in bloqueia antes do gateway e o reuso não toca a
// rede.
import { deepStrictEqual, strictEqual } from "node:assert/strict";
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { encryptText } from "../_shared/asaas.ts";
import { createHandler } from "./handler.ts";

Deno.env.set("ASAAS_MASTER_KEY", "segredo");
const ENCRYPTED_KEY = await encryptText("key");

type Row = Record<string, unknown>;

interface ClaimReply {
  claimed: boolean;
  claimToken: string | null;
  charge: Row | null;
}

interface FakeState {
  profile: Row | null;
  receivable: Row | null;
  customer: Row | null;
  config: Row | null;
  claim: ClaimReply;
  attach: { ok: boolean; afterAttach?: Row };
  messages: Row[];
  calls: string[];
  rpcCalls: Array<{ name: string; args: Row }>;
  auditInserts: Row[];
  now?: () => number;
}

function chain(terminal: () => Promise<{ data: unknown; error: unknown }>) {
  const node: any = {
    select: () => node,
    eq: () => node,
    in: () => node,
    is: () => node,
    limit: () => node,
    order: () => node,
    maybeSingle: terminal,
    single: terminal,
  };
  return node;
}

function builder(table: string, state: FakeState): any {
  if (table === "profiles") {
    return chain(async () => ({ data: state.profile, error: null }));
  }
  if (table === "receivables") {
    const node: any = {
      select: () => node,
      eq: () => node,
      is: () => node,
      maybeSingle: async () => ({ data: state.receivable, error: null }),
    };
    return node;
  }
  if (table === "customers") {
    return chain(async () => ({ data: state.customer, error: null }));
  }
  if (table === "tenant_asaas_config") {
    return chain(async () => ({ data: state.config, error: null }));
  }
  if (table === "messages") {
    const node: any = {
      select: () => node,
      eq: () => node,
      in: () => node,
      maybeSingle: async () => ({ data: state.messages[0] ?? null, error: null }),
      insert: (row: Row) => {
        state.calls.push("messages:insert");
        state.messages.push({ ...row, id: `msg-${state.messages.length + 1}` });
        return { select: () => ({ single: async () => ({ data: { id: "msg-1" }, error: null }) }) };
      },
    };
    return node;
  }
  if (table === "audit_log") {
    return {
      insert: async (row: Row) => {
        state.auditInserts.push(row);
        return { error: null };
      },
    };
  }
  return chain(async () => ({ data: null, error: null }));
}

function fakeService(state: FakeState): SupabaseClient {
  return {
    auth: {
      getUser: async () => ({ data: { user: { id: "u1" } }, error: null }),
    },
    from: (table: string) => builder(table, state),
    rpc: async (name: string, args: Row) => {
      state.calls.push(`rpc:${name}`);
      state.rpcCalls.push({ name, args });
      if (name === "claim_receivable_gateway") {
        if (state.claim.claimed && state.receivable) {
          state.receivable = {
            ...state.receivable,
            gateway_claimed_at: state.claim.claimToken,
            gateway_claim_expires_at: new Date(Date.now() + 60_000).toISOString(),
          };
        }
        return {
          data: {
            claimed: state.claim.claimed,
            claim_token: state.claim.claimToken,
            receivable: state.claim.charge,
          },
          error: null,
        };
      }
      if (name === "attach_receivable_gateway_data") {
        if (!state.attach.ok) {
          if (state.attach.afterAttach) {
            state.receivable = { ...(state.receivable ?? {}), ...state.attach.afterAttach };
          }
          return {
            data: null,
            error: { code: "PT409", message: "GATEWAY_CLAIM_LOST" },
          };
        }
        const merged = {
          ...(state.receivable ?? {}),
          asaas_payment_id: args.p_asaas_payment_id,
          pix_qr_code: args.p_pix_qr_code,
          pix_copy_paste: args.p_pix_copy_paste,
          charge_expires_at: args.p_expires_at,
          gateway_claimed_at: null,
          gateway_claim_expires_at: null,
          ...(state.attach.afterAttach ?? {}),
        };
        state.receivable = merged;
        return { data: merged, error: null };
      }
      if (name === "release_receivable_gateway_claim") {
        return { data: { released: true }, error: null };
      }
      if (name === "clear_receivable_gateway_data") {
        if (state.receivable && state.receivable.asaas_payment_id === args.p_expected_payment_id) {
          state.receivable = {
            ...state.receivable,
            asaas_payment_id: null,
            pix_qr_code: null,
            pix_copy_paste: null,
            charge_expires_at: null,
          };
          return { data: { cleared: true }, error: null };
        }
        return { data: { cleared: false }, error: null };
      }
      return { data: null, error: null };
    },
  } as unknown as SupabaseClient;
}

function baseReceivable(over: Row = {}): Row {
  return {
    id: "9f9e1a0e-1111-4111-8111-111111111111",
    customer_id: "3c3c1a0e-2222-4222-8222-222222222222",
    descricao: "Produto fora do caixa",
    valor_cents: 10_000,
    status: "pendente",
    asaas_payment_id: null,
    pix_qr_code: null,
    pix_copy_paste: null,
    charge_expires_at: null,
    ...over,
  };
}

function baseState(over: Partial<FakeState> = {}): FakeState {
  const receivable = (over.receivable ?? baseReceivable()) as Row;
  return {
    profile: { tenant_id: "t1", role: "admin", active: true },
    receivable,
    customer: { name: "Cliente", email: null, phone: null, whatsapp_opt_in: true },
    config: { active: true, environment: "sandbox", asaas_api_key_encrypted: ENCRYPTED_KEY },
    claim: {
      claimed: true,
      claimToken: "claim-1",
      charge: { charge_id: receivable.id, status: "pendente", amount_cents: 10_000 },
    },
    attach: { ok: true },
    messages: [],
    calls: [],
    rpcCalls: [],
    auditInserts: [],
    ...over,
  };
}

function request(body: unknown, options: { method?: string; token?: string | null } = {}): Request {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (options.token !== null) headers.Authorization = `Bearer ${options.token ?? "jwt"}`;
  return new Request("http://localhost/functions/v1/create-receivable-charge", {
    method: options.method ?? "POST",
    headers,
    body: options.method === "GET" ? undefined : JSON.stringify(body),
  });
}

interface StubOptions {
  /** Resposta de `GET /payments?externalReference` (retomada). */
  existingPayments?: Row[];
  deleteStatus?: number;
  createStatus?: number;
}

function stubAsaas(options: StubOptions = {}) {
  const original = globalThis.fetch;
  const payments: Row[] = [];
  const deletes: string[] = [];
  let fetches = 0;
  globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
    fetches += 1;
    const target = String(url);
    if (init?.method === "DELETE" && target.includes("/payments/")) {
      deletes.push(target);
      return new Response("{}", { status: options.deleteStatus ?? 200 });
    }
    if (target.includes("/customers?externalReference=")) {
      return new Response(JSON.stringify({ data: [] }), { status: 200 });
    }
    if (target.endsWith("/customers")) {
      return new Response(JSON.stringify({ id: "cus1" }), { status: 200 });
    }
    if (target.includes("/payments?externalReference=")) {
      return new Response(JSON.stringify({ data: options.existingPayments ?? [] }), { status: 200 });
    }
    if (target.endsWith("/payments")) {
      if (options.createStatus && options.createStatus >= 400) {
        return new Response(JSON.stringify({ errors: [] }), { status: options.createStatus });
      }
      payments.push(JSON.parse(String(init?.body ?? "{}")) as Row);
      return new Response(JSON.stringify({ id: `pay-${payments.length}` }), { status: 200 });
    }
    if (target.includes("/pixQrCode")) {
      return new Response(JSON.stringify({ encodedImage: "qr", payload: "copy" }), { status: 200 });
    }
    return new Response("{}", { status: 200 });
  }) as typeof fetch;
  return {
    payments,
    deletes,
    fetches: () => fetches,
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
  )(request({ receivable_id: "9f9e1a0e-1111-4111-8111-111111111111" }));
  strictEqual(denied.status, 403);
});

Deno.test("corpo inválido 400; conta inexistente 404; paga/cancelada 409", async () => {
  strictEqual((await handlerFor(baseState())(request({}))).status, 400);

  const missing = await handlerFor(baseState({ receivable: null }))(
    request({ receivable_id: "9f9e1a0e-1111-4111-8111-111111111111" }),
  );
  strictEqual(missing.status, 404);

  const paid = await handlerFor(baseState({ receivable: baseReceivable({ status: "pago" }) }))(
    request({ receivable_id: "9f9e1a0e-1111-4111-8111-111111111111" }),
  );
  strictEqual(paid.status, 409);
  strictEqual((await paid.json()).code, "RECEIVABLE_ALREADY_PAID");

  const parcial = await handlerFor(baseState({ receivable: baseReceivable({ status: "parcial" }) }))(
    request({ receivable_id: "9f9e1a0e-1111-4111-8111-111111111111" }),
  );
  strictEqual(parcial.status, 409);
  strictEqual((await parcial.json()).code, "RECEIVABLE_CHARGE_NOT_PENDING");
});

Deno.test("PIX vivo e válido é reaproveitado sem tocar o gateway", async () => {
  const stub = stubAsaas();
  const state = baseState({
    receivable: baseReceivable({
      asaas_payment_id: "pay-live",
      pix_qr_code: "qr",
      pix_copy_paste: "copia-cola",
      charge_expires_at: new Date(Date.now() + 86_400_000).toISOString(),
    }),
  });
  try {
    const response = await handlerFor(state)(
      request({ receivable_id: "9f9e1a0e-1111-4111-8111-111111111111", notify_whatsapp: true }),
    );
    strictEqual(response.status, 200);
    const body = await response.json();
    strictEqual(body.reused, true);
    strictEqual(body.pix_copy_paste, "copia-cola");
    strictEqual(body.whatsapp.queued, true);
    strictEqual(stub.fetches(), 0);
    strictEqual(stub.payments.length, 0);
    strictEqual(state.messages.length, 1);
  } finally {
    stub.restore();
  }
});

Deno.test("sem opt-in: 422 antes do gateway e nenhuma mensagem", async () => {
  const stub = stubAsaas();
  const state = baseState({
    customer: { name: "Cliente", email: null, phone: null, whatsapp_opt_in: false },
  });
  try {
    const response = await handlerFor(state)(
      request({ receivable_id: "9f9e1a0e-1111-4111-8111-111111111111", notify_whatsapp: true }),
    );
    strictEqual(response.status, 422);
    strictEqual((await response.json()).code, "WHATSAPP_OPT_IN_REQUIRED");
    strictEqual(stub.fetches(), 0);
    strictEqual(state.messages.length, 0);
    strictEqual(state.calls.includes("rpc:claim_receivable_gateway"), false);
  } finally {
    stub.restore();
  }
});

Deno.test("claim ganho: um único POST /payments e attach com o token", async () => {
  const stub = stubAsaas();
  const state = baseState();
  try {
    const response = await handlerFor(state)(
      request({ receivable_id: "9f9e1a0e-1111-4111-8111-111111111111" }),
    );
    strictEqual(response.status, 200);
    const body = await response.json();
    strictEqual(body.reused, false);
    strictEqual(body.pix_copy_paste, "copy");
    strictEqual(stub.payments.length, 1);
    const attach = state.rpcCalls.find((call) => call.name === "attach_receivable_gateway_data");
    strictEqual(attach?.args.p_claim_token, "claim-1");
    strictEqual(attach?.args.p_asaas_payment_id, "pay-1");
    strictEqual(state.receivable?.asaas_payment_id, "pay-1");
  } finally {
    stub.restore();
  }
});

Deno.test("claim perdido: espera o vencedor e NÃO cria nem cancela nada", async () => {
  const stub = stubAsaas();
  const state = baseState({
    receivable: baseReceivable({
      asaas_payment_id: "pay-winner",
      pix_qr_code: "qr-winner",
      pix_copy_paste: "copia-winner",
      charge_expires_at: new Date(Date.now() + 86_400_000).toISOString(),
    }),
    claim: {
      claimed: false,
      claimToken: null,
      charge: { charge_id: "9f9e1a0e-1111-4111-8111-111111111111", status: "pendente" },
    },
  });
  try {
    const response = await handlerFor(state)(
      request({ receivable_id: "9f9e1a0e-1111-4111-8111-111111111111" }),
    );
    strictEqual(response.status, 200);
    strictEqual((await response.json()).reused, true);
    strictEqual(stub.payments.length, 0);
    strictEqual(stub.deletes.length, 0);
  } finally {
    stub.restore();
  }
});

Deno.test("claim perdido sem dados no TTL: 409 GATEWAY_IN_PROGRESS", async () => {
  const stub = stubAsaas();
  const state = baseState({
    claim: { claimed: false, claimToken: null, charge: null },
  });
  // Nenhum dado aparece: a espera usa o TTL padrão (5s) e termina em 409.
  // Env curto vazaria para outros módulos de teste no mesmo processo.
  try {
    const response = await handlerFor(state)(
      request({ receivable_id: "9f9e1a0e-1111-4111-8111-111111111111" }),
    );
    strictEqual(response.status, 409);
    strictEqual((await response.json()).code, "GATEWAY_IN_PROGRESS");
    strictEqual(stub.payments.length, 0);
  } finally {
    stub.restore();
  }
});

Deno.test("attach perdeu a corrida: cancela só o PRÓPRIO órfão, nunca o PIX do vencedor", async () => {
  const stub = stubAsaas();
  const state = baseState({
    attach: { ok: false, afterAttach: { asaas_payment_id: "pay-winner" } },
  });
  try {
    const response = await handlerFor(state)(
      request({ receivable_id: "9f9e1a0e-1111-4111-8111-111111111111" }),
    );
    strictEqual(response.status, 200);
    const body = await response.json();
    strictEqual(body.reused, true);
    // O PIX criado aqui é `pay-1`; ninguém chamou cancel sobre `pay-winner`.
    deepStrictEqual(stub.deletes, ["https://sandbox.asaas.com/api/v3/payments/pay-1"]);
    strictEqual(stub.deletes.every((url) => !url.endsWith("/pay-winner")), true);
  } finally {
    stub.restore();
  }
});

Deno.test("attach perdeu mas o pagamento é o MESMO do vencedor: não cancela", async () => {
  const stub = stubAsaas();
  const state = baseState({
    attach: { ok: false, afterAttach: { asaas_payment_id: "pay-1" } },
  });
  try {
    const response = await handlerFor(state)(
      request({ receivable_id: "9f9e1a0e-1111-4111-8111-111111111111" }),
    );
    strictEqual(response.status, 200);
    strictEqual((await response.json()).reused, true);
    strictEqual(stub.deletes.length, 0);
  } finally {
    stub.restore();
  }
});

Deno.test("PIX expirado: cancela o antigo, limpa a conta e emite um novo", async () => {
  const stub = stubAsaas({ existingPayments: [{ id: "pay-old", status: "CANCELLED" }] });
  const state = baseState({
    receivable: baseReceivable({
      asaas_payment_id: "pay-old",
      pix_qr_code: "qr-old",
      pix_copy_paste: "copia-old",
      charge_expires_at: new Date(Date.now() - 60_000).toISOString(),
    }),
  });
  try {
    const response = await handlerFor(state)(
      request({ receivable_id: "9f9e1a0e-1111-4111-8111-111111111111" }),
    );
    strictEqual(response.status, 200);
    const body = await response.json();
    strictEqual(body.reused, false);
    strictEqual(body.pix_copy_paste, "copy");
    deepStrictEqual(stub.deletes, ["https://sandbox.asaas.com/api/v3/payments/pay-old"]);
    const clear = state.rpcCalls.find((call) => call.name === "clear_receivable_gateway_data");
    strictEqual(clear?.args.p_expected_payment_id, "pay-old");
    strictEqual(stub.payments.length, 1);
    strictEqual(state.receivable?.asaas_payment_id, "pay-1");
  } finally {
    stub.restore();
  }
});

Deno.test("PIX expirado e gateway recusa cancelar: 422 e nenhum segundo PIX", async () => {
  const stub = stubAsaas({ deleteStatus: 400 });
  const state = baseState({
    receivable: baseReceivable({
      asaas_payment_id: "pay-old",
      pix_copy_paste: "copia-old",
      charge_expires_at: new Date(Date.now() - 60_000).toISOString(),
    }),
  });
  try {
    const response = await handlerFor(state)(
      request({ receivable_id: "9f9e1a0e-1111-4111-8111-111111111111" }),
    );
    strictEqual(response.status, 422);
    strictEqual((await response.json()).code, "GATEWAY_CANCEL_FAILED");
    strictEqual(stub.payments.length, 0);
    strictEqual(state.receivable?.asaas_payment_id, "pay-old");
    // Claim liberado mesmo no erro.
    strictEqual(state.calls.includes("rpc:release_receivable_gateway_claim"), true);
  } finally {
    stub.restore();
  }
});

Deno.test("gateway fora: 422 GATEWAY_ERROR e conta sem PIX", async () => {
  const stub = stubAsaas({ createStatus: 500 });
  const state = baseState();
  try {
    const response = await handlerFor(state)(
      request({ receivable_id: "9f9e1a0e-1111-4111-8111-111111111111" }),
    );
    strictEqual(response.status, 422);
    strictEqual((await response.json()).code, "GATEWAY_ERROR");
    strictEqual(state.receivable?.asaas_payment_id, null);
    strictEqual(state.calls.includes("rpc:release_receivable_gateway_claim"), true);
  } finally {
    stub.restore();
  }
});
