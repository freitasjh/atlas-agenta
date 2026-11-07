import { strictEqual, deepStrictEqual } from "node:assert/strict";
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { encryptText } from "../_shared/asaas.ts";
import { createHandler } from "./handler.ts";
import { logEvent } from "../_shared/http.ts";

Deno.env.set("ASAAS_MASTER_KEY", "segredo");
const ENCRYPTED_KEY = await encryptText("key");

type Row = Record<string, unknown>;

interface FakeState {
  profile: Row | null;
  tables: Record<string, Row[]>;
  charge: Row | null;
  claimed: boolean;
  claimToken: string | null;
  rpc: (name: string, args: Row) => { data: unknown; error: { code: string; message: string } | null };
  calls: string[];
  auditInserts: Row[];
}

function builder(table: string, state: FakeState): any {
  const rows =
    table === "profiles" && state.profile !== null
      ? [state.profile]
      : table === "charges" && state.charge !== null
      ? [state.charge]
      : state.tables[table] ?? [];
  const query: any = {
    select: () => query,
    eq: () => query,
    order: () => query,
    maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
    single: async () => ({ data: rows[0] ?? null, error: null }),
    then: (onFulfilled: any, onRejected: any) =>
      Promise.resolve({ data: rows, error: null }).then(onFulfilled, onRejected),
    insert: async (row: Row) => {
      state.auditInserts.push(row);
      return { error: null };
    },
  };
  return query;
}

function fakeService(state: FakeState): SupabaseClient {
  return {
    auth: {
      getUser: async () => {
        state.calls.push("identity");
        return { data: { user: { id: "u1" } }, error: null };
      },
    },
    from: (table: string) => builder(table, state),
    rpc: async (name: string, args: Row) => {
      state.calls.push(`rpc:${name}`);
      if (name === "claim_charge_gateway") {
        if (!state.claimed && state.charge !== null && state.charge.asaas_payment_id == null) {
          state.claimed = true;
          state.claimToken = `claim-${String(state.calls.length)}`;
          return {
            data: {
              claimed: true,
              claim_token: state.claimToken,
              charge: { ...state.charge, gateway_claimed_at: state.claimToken },
            },
            error: null,
          };
        }
        return { data: { claimed: false, charge: state.charge }, error: null };
      }
      if (name === "attach_charge_gateway_data") {
        state.calls.push("attach-token:" + String(args.p_claim_token ?? ""));
        const current = state.charge ?? {};
        state.charge = {
          ...current,
          id: args.p_charge_id,
          amount_cents: current.amount_cents ?? 3000,
          status: "pendente",
          asaas_payment_id: args.p_asaas_payment_id,
          pix_qr_code: args.p_pix_qr_code,
          pix_copy_paste: args.p_pix_copy_paste,
          expires_at: current.expires_at ?? "2026-11-09T18:00:00Z",
        };
        state.claimed = false;
        state.claimToken = null;
        return {
          data: {
            charge_id: state.charge.id,
            amount_cents: state.charge.amount_cents,
            status: "pendente",
            asaas_payment_id: state.charge.asaas_payment_id,
            pix_qr_code: state.charge.pix_qr_code,
            pix_copy_paste: state.charge.pix_copy_paste,
            expires_at: state.charge.expires_at,
          },
          error: null,
        };
      }
      if (name === "release_charge_reservation") {
        state.claimed = false;
        state.claimToken = null;
        return { data: { released: true, charge_id: args.p_charge_id }, error: null };
      }
      if (name === "reopen_charge_for_reissue") {
        const reopened: Row = {
          ...(state.charge ?? {}),
          id: args.p_charge_id,
          status: "pendente",
          asaas_payment_id: null,
          pix_qr_code: null,
          pix_copy_paste: null,
        };
        state.charge = reopened;
        return {
          data: {
            charge_id: reopened.id,
            amount_cents: reopened.amount_cents,
            status: "pendente",
            asaas_payment_id: null,
            pix_qr_code: null,
            pix_copy_paste: null,
            expires_at: reopened.expires_at,
            reused: false,
            reopened: true,
            reissue: false,
            requested_amount_mismatch: false,
          },
          error: null,
        };
      }
      return state.rpc(name, args);
    },
  } as unknown as SupabaseClient;
}

function baseState(overrides: Partial<FakeState> = {}): FakeState {
  const summary = {
    price_cents: 10_000,
    total_paid_cents: 0,
    tip_cents: 0,
    reserved_cents: 0,
    remaining_cents: 10_000,
    payment_status: "sem_pagamento",
    pending_charge_id: null,
    pending_charge_amount_cents: 0,
  };
  return {
    profile: { tenant_id: "t1", role: "admin", active: true },
    tables: {
      profiles: [{ tenant_id: "t1", role: "admin", active: true }],
      appointments: [{
        id: "11111111-1111-4111-8111-111111111111",
        status: "concluido",
        starts_at: "2026-11-06T18:00:00Z",
        price_cents: 10_000,
        customer_id: "c1",
        service_id: "s1",
        professional_id: "p1",
      }],
      customers: [{ name: "Cliente" }],
      services: [{ name: "Serviço" }],
      professionals: [{ name: "Profissional", id: "p1" }],
      appointment_payments: [],
      charges: [],
      tenant_asaas_config: [{
        active: true,
        environment: "sandbox",
        asaas_api_key_encrypted: ENCRYPTED_KEY,
      }],
    },
    charge: null,
    claimed: false,
    claimToken: null,
    rpc: (name) => {
      if (name === "register_appointment_payments") {
        return {
          data: {
            appointment_id: "11111111-1111-4111-8111-111111111111",
            appointment_status: "concluido",
            payments: [],
            total_paid_cents: 0,
            tip_cents: 0,
            reserved_cents: 0,
            remaining_cents: 10_000,
            payment_status: "sem_pagamento",
            pix_amount_cents: 0,
            pix_already_pending: false,
            replayed: false,
          },
          error: null,
        };
      }
      if (name === "appointment_payment_summary") return { data: summary, error: null };
      return { data: null, error: null };
    },
    calls: [],
    auditInserts: [],
    ...overrides,
  };
}

const APPOINTMENT_ID = "11111111-1111-4111-8111-111111111111";
const KEY = "22222222-2222-4222-8222-222222222222";
const TOKEN = "jwt-teste";

function handlerFor(state: FakeState, throwOnCreate = false) {
  return createHandler({
    createService: () => {
      if (throwOnCreate) throw new Error("config");
      return fakeService(state);
    },
  });
}

function request(options: { method?: string; token?: string | null; body?: unknown } = {}): Request {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (options.token !== null) headers.Authorization = `Bearer ${options.token ?? TOKEN}`;
  return new Request("http://localhost/functions/v1/register-appointment-payments", {
    method: options.method ?? "POST",
    headers,
    body: options.method === "GET" ? undefined : JSON.stringify(options.body ?? {}),
  });
}

function stubAsaas(delayMs = 0, options: { deleteStatus?: number } = {}) {
  const original = globalThis.fetch;
  const payments: Row[] = [];
  const deletes: string[] = [];
  globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
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
      return new Response(JSON.stringify({ data: [] }), { status: 200 });
    }
    if (target.endsWith("/payments")) {
      if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
      payments.push(JSON.parse(String(init?.body ?? "{}")) as Row);
      return new Response(JSON.stringify({ id: `pay-${payments.length}` }), { status: 200 });
    }
    if (target.includes("/pixQrCode")) {
      return new Response(JSON.stringify({ encodedImage: "qr-new", payload: "copy-new" }), {
        status: 200,
      });
    }
    return new Response("{}", { status: 200 });
  }) as typeof fetch;
  return {
    payments,
    deletes,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

Deno.test("OPTIONS 200 sem criar service", async () => {
  let created = 0;
  const handler = createHandler({
    createService: () => {
      created += 1;
      return fakeService(baseState());
    },
  });
  const response = await handler(new Request("http://x", { method: "OPTIONS" }));
  strictEqual(response.status, 200);
  strictEqual(created, 0);
});

Deno.test("GET 405 e configuração ausente 500", async () => {
  const getResponse = await handlerFor(baseState())(request({ method: "GET" }));
  strictEqual(getResponse.status, 405);
  const configResponse = await handlerFor(baseState(), true)(request());
  strictEqual(configResponse.status, 500);
  const body = await configResponse.json();
  strictEqual(body.code, "INTERNAL");
});

Deno.test("sem token 401 e papel fora da lista 403", async () => {
  const noToken = await handlerFor(baseState())(request({ token: null }));
  strictEqual(noToken.status, 401);

  const denied = await handlerFor(
    baseState({ profile: { tenant_id: "t1", role: "super_admin", active: true } }),
  )(request());
  strictEqual(denied.status, 403);
  const body = await denied.json();
  strictEqual(body.code, "FORBIDDEN");
});

Deno.test("corpo com tenant_id/role => 400 antes da RPC", async () => {
  const state = baseState();
  const response = await handlerFor(state)(
    request({
      body: {
        appointment_id: APPOINTMENT_ID,
        idempotency_key: KEY,
        close_appointment: true,
        payments: [],
        tenant_id: "t1",
      },
    }),
  );
  strictEqual(response.status, 400);
  const body = await response.json();
  strictEqual(body.code, "INVALID_BODY");
  strictEqual(state.calls.includes("rpc:register_appointment_payments"), false);
});

Deno.test("idempotency_key ausente => 400 IDEMPOTENCY_KEY_REQUIRED", async () => {
  const state = baseState();
  const response = await handlerFor(state)(
    request({ body: { appointment_id: APPOINTMENT_ID, close_appointment: true, payments: [] } }),
  );
  strictEqual(response.status, 400);
  const body = await response.json();
  strictEqual(body.code, "IDEMPOTENCY_KEY_REQUIRED");
  strictEqual(state.calls.includes("rpc:register_appointment_payments"), false);
});

Deno.test("erro PT409 da RPC vira 409 com código estável", async () => {
  const state = baseState({
    rpc: (name) => {
      if (name === "register_appointment_payments") {
        return { data: null, error: { code: "PT409", message: "AMOUNT_EXCEEDS_REMAINING" } };
      }
      return { data: null, error: null };
    },
  });
  const response = await handlerFor(state)(
    request({
      body: {
        appointment_id: APPOINTMENT_ID,
        idempotency_key: KEY,
        close_appointment: true,
        payments: [{ method: "dinheiro", amount_cents: 10_000 }],
      },
    }),
  );
  strictEqual(response.status, 409);
  const body = await response.json();
  strictEqual(body.code, "AMOUNT_EXCEEDS_REMAINING");
});

Deno.test("erro não-domínio vira 500 INTERNAL sem ecoar mensagem", async () => {
  const state = baseState({
    rpc: (name) => {
      if (name === "register_appointment_payments") {
        return { data: null, error: { code: "23505", message: "duplicate key value ..." } };
      }
      return { data: null, error: null };
    },
  });
  const response = await handlerFor(state)(
    request({
      body: {
        appointment_id: APPOINTMENT_ID,
        idempotency_key: KEY,
        close_appointment: true,
        payments: [{ method: "dinheiro", amount_cents: 10_000 }],
      },
    }),
  );
  strictEqual(response.status, 500);
  const text = await response.text();
  strictEqual(text.includes("duplicate key"), false);
  strictEqual(JSON.parse(text).code, "INTERNAL");
});

Deno.test("sucesso: identidade antes do body e da RPC; settlement é devolvido", async () => {
  const state = baseState();
  const response = await handlerFor(state)(
    request({
      body: {
        appointment_id: APPOINTMENT_ID,
        idempotency_key: KEY,
        close_appointment: true,
        payments: [],
      },
    }),
  );
  strictEqual(response.status, 200);
  const body = await response.json();
  strictEqual(body.charge, null);
  strictEqual(body.settlement.payment_status, "sem_pagamento");

  const identityIndex = state.calls.indexOf("identity");
  const rpcIndex = state.calls.indexOf("rpc:register_appointment_payments");
  strictEqual(identityIndex, 0);
  strictEqual(rpcIndex > identityIndex, true);
});

Deno.test("logEvent descarta chaves fora da whitelist", () => {
  const lines: string[] = [];
  const original = console.log;
  console.log = (message: unknown) => {
    lines.push(String(message));
  };
  try {
    logEvent("teste", {
      tenant_id: "t1",
      actor_id: "u1",
      amount_cents: 100,
      phone: "11999999999",
      name: "Cliente",
    } as never);
  } finally {
    console.log = original;
  }
  strictEqual(lines.length, 1);
  const parsed = JSON.parse(lines[0]);
  strictEqual(parsed.tenant_id, "t1");
  strictEqual("phone" in parsed, false);
  strictEqual("name" in parsed, false);
});

const REGISTER_SUMMARY = {
  price_cents: 10_000,
  total_paid_cents: 0,
  tip_cents: 0,
  reserved_cents: 3_000,
  remaining_cents: 7_000,
  payment_status: "aguardando_pix",
  pending_charge_id: "ch1",
  pending_charge_amount_cents: 3_000,
};

function registerRpc(options: { replayed?: boolean; pixAmount?: number } = {}) {
  return (name: string, _args?: Row) => {
    if (name === "register_appointment_payments") {
      return {
        data: {
          appointment_id: APPOINTMENT_ID,
          appointment_status: "concluido",
          payments: [],
          total_paid_cents: 0,
          tip_cents: 0,
          reserved_cents: 0,
          remaining_cents: 10_000,
          payment_status: "sem_pagamento",
          pix_amount_cents: options.pixAmount ?? 3_000,
          pix_already_pending: false,
          replayed: options.replayed === true,
        },
        error: null,
      };
    }
    if (name === "appointment_payment_summary") return { data: REGISTER_SUMMARY, error: null };
    return { data: null, error: null };
  };
}

Deno.test("replay com PIX: não reserva nem chama o gateway; devolve a cobrança pendente", async () => {
  const state = baseState({
    rpc: registerRpc({ replayed: true }),
    charge: {
      id: "ch1",
      amount_cents: 3000,
      status: "pendente",
      asaas_payment_id: "pay1",
      pix_qr_code: "qr-existing",
      pix_copy_paste: "copy-existing",
      expires_at: "2099-01-01T00:00:00Z",
    },
  });
  const stub = stubAsaas();
  try {
    const response = await handlerFor(state)(
      request({
        body: {
          appointment_id: APPOINTMENT_ID,
          idempotency_key: KEY,
          close_appointment: true,
          payments: [{ method: "pix_sistema", amount_cents: 3000 }],
        },
      }),
    );
    strictEqual(response.status, 200);
    const body = await response.json();
    strictEqual(body.charge.id, "ch1");
    strictEqual(body.charge.pix_qr_code, "qr-existing");
    strictEqual(state.calls.includes("rpc:reserve_appointment_charge"), false);
    strictEqual(stub.payments.length, 0);
  } finally {
    stub.restore();
  }
});

Deno.test("replay com PIX pago/cancelado: 200 com charge null e nenhuma chamada ao gateway", async () => {
  for (const terminalStatus of ["pago", "cancelado"]) {
    const state = baseState({
      rpc: registerRpc({ replayed: true }),
      charge: {
        id: "ch1",
        amount_cents: 3000,
        status: terminalStatus,
        asaas_payment_id: "pay-old",
        pix_qr_code: null,
        pix_copy_paste: null,
        expires_at: "2026-11-01T00:00:00Z",
      },
    });
    const stub = stubAsaas();
    try {
      const response = await handlerFor(state)(
        request({
          body: {
            appointment_id: APPOINTMENT_ID,
            idempotency_key: KEY,
            close_appointment: true,
            payments: [{ method: "pix_sistema", amount_cents: 3000 }],
          },
        }),
      );
      strictEqual(response.status, 200);
      const body = await response.json();
      strictEqual(body.charge, null);
      strictEqual(state.calls.includes("rpc:reserve_appointment_charge"), false);
      strictEqual(stub.payments.length, 0);
      strictEqual(stub.deletes.length, 0);
    } finally {
      stub.restore();
    }
  }
});

Deno.test("reemissão: cancela anterior, reabre a MESMA linha e devolve novo QR", async () => {
  const base = registerRpc();
  const state = baseState({
    rpc: (name, args) => {
      if (name === "reserve_appointment_charge") {
        return {
          data: {
            reissue: true,
            previous_charge_id: "ch-old",
            previous_asaas_payment_id: "pay-old",
            charge_id: "ch-old",
            amount_cents: 3000,
            status: "expirado",
            asaas_payment_id: "pay-old",
            pix_qr_code: null,
            pix_copy_paste: null,
            expires_at: "2026-11-01T00:00:00Z",
            reused: false,
            reopened: false,
            requested_amount_mismatch: false,
          },
          error: null,
        };
      }
      return base(name, args);
    },
    charge: {
      id: "ch-old",
      amount_cents: 3000,
      status: "expirado",
      asaas_payment_id: "pay-old",
      pix_qr_code: null,
      pix_copy_paste: null,
      expires_at: "2026-11-01T00:00:00Z",
    },
  });
  const stub = stubAsaas();
  try {
    const response = await handlerFor(state)(
      request({
        body: {
          appointment_id: APPOINTMENT_ID,
          idempotency_key: KEY,
          close_appointment: true,
          payments: [{ method: "pix_sistema", amount_cents: 3000 }],
        },
      }),
    );
    strictEqual(response.status, 200);
    const body = await response.json();
    strictEqual(body.charge.id, "ch-old");
    strictEqual(body.charge.pix_qr_code, "qr-new");
    deepStrictEqual(stub.deletes.length, 1);
    strictEqual(stub.deletes[0]?.endsWith("/payments/pay-old"), true);
    strictEqual(stub.payments.length, 1);
    strictEqual(state.calls.includes("rpc:reopen_charge_for_reissue"), true);
    strictEqual(
      state.auditInserts.some((row) => row.action === "charge_previous_cancelled"),
      true,
    );
  } finally {
    stub.restore();
  }
});

Deno.test("reemissão: falha do cancelamento => 422 sem reabrir e sem novo POST", async () => {
  const base = registerRpc();
  const state = baseState({
    rpc: (name, args) => {
      if (name === "reserve_appointment_charge") {
        return {
          data: {
            reissue: true,
            previous_charge_id: "ch-old",
            previous_asaas_payment_id: "pay-old",
            charge_id: "ch-old",
            amount_cents: 3000,
            status: "expirado",
            asaas_payment_id: "pay-old",
            pix_qr_code: null,
            pix_copy_paste: null,
            expires_at: "2026-11-01T00:00:00Z",
            reused: false,
            reopened: false,
            requested_amount_mismatch: false,
          },
          error: null,
        };
      }
      return base(name, args);
    },
    charge: {
      id: "ch-old",
      amount_cents: 3000,
      status: "expirado",
      asaas_payment_id: "pay-old",
      pix_qr_code: null,
      pix_copy_paste: null,
      expires_at: "2026-11-01T00:00:00Z",
    },
  });
  const stub = stubAsaas(0, { deleteStatus: 500 });
  try {
    const response = await handlerFor(state)(
      request({
        body: {
          appointment_id: APPOINTMENT_ID,
          idempotency_key: KEY,
          close_appointment: true,
          payments: [{ method: "pix_sistema", amount_cents: 3000 }],
        },
      }),
    );
    strictEqual(response.status, 422);
    const body = await response.json();
    strictEqual(body.code, "GATEWAY_CANCEL_FAILED");
    strictEqual(state.calls.includes("rpc:reopen_charge_for_reissue"), false);
    strictEqual(stub.payments.length, 0);
    strictEqual(state.claimed, false);
  } finally {
    stub.restore();
  }
});

Deno.test("concorrência: 2 lotes paralelos geram exatamente 1 POST /payments", async () => {
  const state = baseState({
    rpc: (name, args) => {
      if (name === "register_appointment_payments") {
        return {
          data: {
            appointment_id: APPOINTMENT_ID,
            appointment_status: "concluido",
            payments: [],
            total_paid_cents: 0,
            tip_cents: 0,
            reserved_cents: 0,
            remaining_cents: 10_000,
            payment_status: "sem_pagamento",
            pix_amount_cents: 3_000,
            pix_already_pending: false,
            replayed: false,
          },
          error: null,
        };
      }
      if (name === "reserve_appointment_charge") {
        return {
          data: {
            charge_id: "ch1",
            amount_cents: 3000,
            status: "pendente",
            asaas_payment_id: null,
            pix_qr_code: null,
            pix_copy_paste: null,
            expires_at: "2026-11-09T18:00:00Z",
            reused: false,
            reopened: false,
            reissue: false,
            requested_amount_mismatch: false,
          },
          error: null,
        };
      }
      if (name === "appointment_payment_summary") return { data: REGISTER_SUMMARY, error: null };
      return { data: null, error: null };
    },
    charge: {
      id: "ch1",
      amount_cents: 3000,
      status: "pendente",
      asaas_payment_id: null,
      pix_qr_code: null,
      pix_copy_paste: null,
      expires_at: "2026-11-09T18:00:00Z",
    },
  });
  const stub = stubAsaas(300);
  try {
    const handler = handlerFor(state);
    const call = () =>
      handler(
        request({
          body: {
            appointment_id: APPOINTMENT_ID,
            idempotency_key: KEY,
            close_appointment: true,
            payments: [{ method: "pix_sistema", amount_cents: 3000 }],
          },
        }),
      );

    const [first, second] = await Promise.all([call(), call()]);
    strictEqual(first.status, 200);
    strictEqual(second.status, 200);
    const firstBody = await first.json();
    const secondBody = await second.json();
    strictEqual(firstBody.charge.id, "ch1");
    strictEqual(secondBody.charge.id, "ch1");
    strictEqual(firstBody.charge.pix_qr_code, secondBody.charge.pix_qr_code);
    strictEqual(stub.payments.length, 1);
  } finally {
    stub.restore();
  }
});

const RESERVE_CHARGE = {
  charge_id: "ch1",
  amount_cents: 3000,
  status: "pendente",
  asaas_payment_id: null,
  pix_qr_code: null,
  pix_copy_paste: null,
  expires_at: "2026-11-09T18:00:00Z",
  reused: false,
  reopened: false,
  reissue: false,
  requested_amount_mismatch: false,
};

function claimLostState() {
  const base = registerRpc();
  return baseState({
    rpc: (name, args) => {
      if (name === "reserve_appointment_charge") return { data: RESERVE_CHARGE, error: null };
      return base(name, args);
    },
    charge: {
      id: "ch1",
      amount_cents: 3000,
      status: "pendente",
      asaas_payment_id: null,
      pix_qr_code: null,
      pix_copy_paste: null,
      expires_at: "2026-11-09T18:00:00Z",
    },
  });
}

Deno.test("claim perdido no attach: cancela o payment órfão e devolve 409 GATEWAY_IN_PROGRESS", async () => {
  const state = claimLostState();
  const stub = stubAsaas();
  try {
    const service = fakeService(state);
    const originalRpc = (service as unknown as { rpc: Function }).rpc;
    (service as unknown as { rpc: Function }).rpc = async (name: string, args: Row) => {
      if (name === "attach_charge_gateway_data") {
        return { data: null, error: { code: "PT409", message: "GATEWAY_CLAIM_LOST" } };
      }
      return originalRpc(name, args);
    };
    const handler = createHandler({ createService: () => service });
    const response = await handler(
      request({
        body: {
          appointment_id: APPOINTMENT_ID,
          idempotency_key: KEY,
          close_appointment: true,
          payments: [{ method: "pix_sistema", amount_cents: 3000 }],
        },
      }),
    );
    strictEqual(response.status, 409);
    const body = await response.json();
    strictEqual(body.code, "GATEWAY_IN_PROGRESS");
    strictEqual(body.retryable, true);
    strictEqual(stub.payments.length, 1);
    deepStrictEqual(stub.deletes.length, 1);
    strictEqual(stub.deletes[0]?.endsWith("/payments/pay-1"), true);
    strictEqual(state.calls.includes("rpc:release_charge_reservation"), false);
  } finally {
    stub.restore();
  }
});

Deno.test("claim perdido com o mesmo payment já anexado: reconcilia 200 sem DELETE", async () => {
  const state = claimLostState();
  const stub = stubAsaas();
  try {
    const service = fakeService(state);
    const originalRpc = (service as unknown as { rpc: Function }).rpc;
    (service as unknown as { rpc: Function }).rpc = async (name: string, args: Row) => {
      if (name === "attach_charge_gateway_data") {
        state.charge = {
          ...(state.charge ?? {}),
          asaas_payment_id: args.p_asaas_payment_id,
          pix_qr_code: "qr-winner",
          pix_copy_paste: "copy-winner",
        };
        return { data: null, error: { code: "PT409", message: "GATEWAY_CLAIM_LOST" } };
      }
      return originalRpc(name, args);
    };
    const handler = createHandler({ createService: () => service });
    const response = await handler(
      request({
        body: {
          appointment_id: APPOINTMENT_ID,
          idempotency_key: KEY,
          close_appointment: true,
          payments: [{ method: "pix_sistema", amount_cents: 3000 }],
        },
      }),
    );
    strictEqual(response.status, 200);
    const body = await response.json();
    strictEqual(body.charge.id, "ch1");
    strictEqual(body.charge.pix_qr_code, "qr-winner");
    strictEqual(stub.payments.length, 1);
    strictEqual(stub.deletes.length, 0);
  } finally {
    stub.restore();
  }
});
