import { strictEqual, deepStrictEqual } from "node:assert/strict";
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { encryptText } from "../_shared/asaas.ts";
import { createHandler } from "./handler.ts";

Deno.env.set("ASAAS_MASTER_KEY", "segredo");
const ENCRYPTED_KEY = await encryptText("key");

type Row = Record<string, unknown>;

interface FakeState {
  profile: Row | null;
  appointment: Row | null;
  config: Row | null;
  reserve: { data: unknown; error: { code: string; message: string } | null };
  attach: { data: unknown; error: { code: string; message: string } | null };
  charge: Row | null;
  claimed: boolean;
  claimToken: string | null;
  calls: string[];
  auditInserts: Row[];
}

function builder(table: string, state: FakeState): any {
  if (table === "profiles") {
    const row = state.profile;
    return {
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: row, error: null }) }) }),
    };
  }
  if (table === "appointments") {
    const row = state.appointment;
    return {
      select: () => ({
        eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: row, error: null }) }) }),
      }),
    };
  }
  if (table === "customers") {
    return {
      select: () => ({
        eq: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: { name: "Cliente", email: null, phone: null }, error: null }),
          }),
        }),
      }),
    };
  }
  if (table === "tenant_asaas_config") {
    return {
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: state.config, error: null }) }) }),
    };
  }
  if (table === "audit_log") {
    return {
      insert: async (row: Row) => {
        state.auditInserts.push(row);
        return { error: null };
      },
    };
  }
  if (table === "charges") {
    return {
      select: () => ({
        eq: () => ({
          eq: () => ({ maybeSingle: async () => ({ data: state.charge, error: null }) }),
        }),
      }),
    };
  }
  return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) };
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
      if (name === "reserve_appointment_charge") return state.reserve;
      if (name === "attach_charge_gateway_data") {
        state.calls.push("attach-token:" + String(args.p_claim_token ?? ""));
        if (state.attach.error === null && state.attach.data !== null) {
          state.charge = {
            ...(state.charge ?? {}),
            ...(state.attach.data as Row),
          };
          state.claimed = false;
          state.claimToken = null;
        }
        return state.attach;
      }
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
      if (name === "release_charge_reservation") {
        state.claimToken = null;
        state.claimed = false;
        return { data: { released: true, charge_id: args.p_charge_id }, error: null };
      }
      if (name === "reopen_charge_for_reissue") {
        const reopened: Row = {
          ...(state.charge ?? {}),
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
      return { data: null, error: null };
    },
  } as unknown as SupabaseClient;
}

function baseState(overrides: Partial<FakeState> = {}): FakeState {
  const state: FakeState = {
    profile: { tenant_id: "t1", role: "admin", active: true },
    appointment: {
      id: "11111111-1111-4111-8111-111111111111",
      status: "concluido",
      customer_id: "c1",
      professional_id: "p1",
    },
    config: { active: true, environment: "sandbox", asaas_api_key_encrypted: ENCRYPTED_KEY },
    reserve: {
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
        requested_amount_mismatch: false,
      },
      error: null,
    },
    attach: {
      data: {
        charge_id: "ch1",
        amount_cents: 3000,
        status: "pendente",
        asaas_payment_id: "pay1",
        pix_qr_code: "qr",
        pix_copy_paste: "copy",
        expires_at: "2026-11-09T18:00:00Z",
      },
      error: null,
    },
    charge: null,
    claimed: false,
    claimToken: null,
    calls: [],
    auditInserts: [],
    ...overrides,
  };

  if (overrides.charge === undefined) {
    const reserved = state.reserve.data as Row | null;
    state.charge = reserved === null
      ? null
      : {
        id: reserved.charge_id,
        amount_cents: reserved.amount_cents,
        status: reserved.status,
        asaas_payment_id: reserved.asaas_payment_id,
        pix_qr_code: reserved.pix_qr_code,
        pix_copy_paste: reserved.pix_copy_paste,
        expires_at: reserved.expires_at,
      };
  }

  return state;
}

const APPOINTMENT_ID = "11111111-1111-4111-8111-111111111111";
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
  return new Request("http://localhost/functions/v1/create-charge", {
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
      return new Response(JSON.stringify({ encodedImage: "qr", payload: "copy" }), { status: 200 });
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

Deno.test("OPTIONS 200 sem criar service; GET 405; config ausente 500", async () => {
  let created = 0;
  const options = createHandler({
    createService: () => {
      created += 1;
      return fakeService(baseState());
    },
  });
  strictEqual((await options(new Request("http://x", { method: "OPTIONS" }))).status, 200);
  strictEqual(created, 0);

  strictEqual((await handlerFor(baseState())(request({ method: "GET" }))).status, 405);
  strictEqual((await handlerFor(baseState(), true)(request())).status, 500);
});

Deno.test("sem token 401; role fora da lista 403", async () => {
  strictEqual((await handlerFor(baseState())(request({ token: null }))).status, 401);
  const denied = await handlerFor(
    baseState({ profile: { tenant_id: "t1", role: "super_admin", active: true } }),
  )(request({ body: { appointment_id: APPOINTMENT_ID } }));
  strictEqual(denied.status, 403);
});

Deno.test("corpo inválido 400; atendimento ausente 404; sem config 422", async () => {
  strictEqual((await handlerFor(baseState())(request({ body: {} }))).status, 400);

  const missing = await handlerFor(baseState({ appointment: null }))(
    request({ body: { appointment_id: APPOINTMENT_ID } }),
  );
  strictEqual(missing.status, 404);

  const noConfig = await handlerFor(baseState({ config: null }))(
    request({ body: { appointment_id: APPOINTMENT_ID } }),
  );
  strictEqual(noConfig.status, 422);
  const body = await noConfig.json();
  strictEqual(body.code, "ASAAS_NOT_CONFIGURED");
});

Deno.test("erro de reserva PT409 vira 409 com código estável", async () => {
  const state = baseState({
    reserve: { data: null, error: { code: "PT409", message: "AMOUNT_EXCEEDS_REMAINING" } },
  });
  const response = await handlerFor(state)(
    request({ body: { appointment_id: APPOINTMENT_ID, amount_cents: 5000 } }),
  );
  strictEqual(response.status, 409);
  const body = await response.json();
  strictEqual(body.code, "AMOUNT_EXCEEDS_REMAINING");
});

Deno.test("cobrança pendente com QR é reapresentada sem gateway", async () => {
  const state = baseState({
    reserve: {
      data: {
        charge_id: "ch-existing",
        amount_cents: 3000,
        status: "pendente",
        asaas_payment_id: "pay-existing",
        pix_qr_code: "qr-existing",
        pix_copy_paste: "copy-existing",
        expires_at: "2026-11-09T18:00:00Z",
        reused: true,
        reopened: false,
        requested_amount_mismatch: false,
      },
      error: null,
    },
  });
  const stub = stubAsaas();
  try {
    const response = await handlerFor(state)(
      request({ body: { appointment_id: APPOINTMENT_ID, amount_cents: 3000 } }),
    );
    strictEqual(response.status, 200);
    const body = await response.json();
    strictEqual(body.reused, true);
    strictEqual(body.pix_qr_code, "qr-existing");
    strictEqual(stub.payments.length, 0);
  } finally {
    stub.restore();
  }
});

Deno.test("criação feliz: reserva -> gateway -> attach e 200", async () => {
  const state = baseState();
  const stub = stubAsaas();
  try {
    const response = await handlerFor(state)(
      request({
        body: {
          appointment_id: APPOINTMENT_ID,
          amount_cents: 3000,
          idempotency_key: "22222222-2222-4222-8222-222222222222",
        },
      }),
    );
    strictEqual(response.status, 200);
    const body = await response.json();
    strictEqual(body.charge_id, "ch1");
    strictEqual(body.pix_qr_code, "qr");
    strictEqual(body.reused, false);
    strictEqual(stub.payments.length, 1);
    strictEqual(stub.payments[0]?.externalReference, "ch1");
    strictEqual(
      state.calls.indexOf("rpc:reserve_appointment_charge") <
        state.calls.indexOf("rpc:attach_charge_gateway_data"),
      true,
    );
  } finally {
    stub.restore();
  }
});

Deno.test("falha do gateway: 422 GATEWAY_ERROR e reserva cancelada (sem 5xx)", async () => {
  const state = baseState();
  const original = globalThis.fetch;
  globalThis.fetch = (async () => {
    throw new TypeError("network down");
  }) as typeof fetch;
  try {
    const response = await handlerFor(state)(
      request({ body: { appointment_id: APPOINTMENT_ID, amount_cents: 3000 } }),
    );
    strictEqual(response.status, 422);
    const body = await response.json();
    strictEqual(body.code, "GATEWAY_ERROR");
    strictEqual(
      state.calls.includes("rpc:release_charge_reservation"),
      true,
    );
    strictEqual(
      state.auditInserts.some((row) => row.action === "charge_creation_failed"),
      true,
    );
  } finally {
    globalThis.fetch = original;
  }
});

Deno.test("concorrência: 2 POSTs paralelos geram exatamente 1 POST /payments", async () => {
  const state = baseState();
  const stub = stubAsaas(300);
  try {
    const handler = handlerFor(state);
    const call = () =>
      handler(
        request({
          body: {
            appointment_id: APPOINTMENT_ID,
            amount_cents: 3000,
            idempotency_key: "22222222-2222-4222-8222-222222222222",
          },
        }),
      );

    const [first, second] = await Promise.all([call(), call()]);
    strictEqual(first.status, 200);
    strictEqual(second.status, 200);

    const firstBody = await first.json();
    const secondBody = await second.json();
    strictEqual(firstBody.charge_id, secondBody.charge_id);
    strictEqual(firstBody.pix_qr_code, secondBody.pix_qr_code);
    strictEqual(stub.payments.length, 1);
  } finally {
    stub.restore();
  }
});

Deno.test("reemissão: cancela a anterior no gateway, reabre a MESMA linha e cria novo QR", async () => {
  const state = baseState({
    reserve: {
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
        expires_at: "2026-11-01T10:00:00Z",
        reused: false,
        reopened: false,
        requested_amount_mismatch: false,
      },
      error: null,
    },
    attach: {
      data: {
        charge_id: "ch-old",
        amount_cents: 3000,
        status: "pendente",
        asaas_payment_id: "pay-new",
        pix_qr_code: "qr-new",
        pix_copy_paste: "copy-new",
        expires_at: "2026-11-09T18:00:00Z",
      },
      error: null,
    },
  });
  const stub = stubAsaas();
  try {
    const response = await handlerFor(state)(
      request({
        body: {
          appointment_id: APPOINTMENT_ID,
          amount_cents: 3000,
          idempotency_key: "33333333-3333-4333-8333-333333333333",
        },
      }),
    );
    strictEqual(response.status, 200);
    const body = await response.json();
    strictEqual(body.charge_id, "ch-old");
    strictEqual(body.pix_qr_code, "qr-new");
    deepStrictEqual(stub.deletes.length, 1);
    strictEqual(stub.deletes[0]?.endsWith("/payments/pay-old"), true);
    strictEqual(stub.payments.length, 1);
    strictEqual(
      state.auditInserts.some((row) => row.action === "charge_previous_cancelled"),
      true,
    );
  } finally {
    stub.restore();
  }
});

Deno.test("reemissão: falha ao cancelar no gateway => 422 e nada é reaberto/criado", async () => {
  const state = baseState({
    reserve: {
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
        expires_at: "2026-11-01T10:00:00Z",
        reused: false,
        reopened: false,
        requested_amount_mismatch: false,
      },
      error: null,
    },
  });
  const stub = stubAsaas(0, { deleteStatus: 500 });
  try {
    const response = await handlerFor(state)(
      request({
        body: {
          appointment_id: APPOINTMENT_ID,
          amount_cents: 3000,
          idempotency_key: "44444444-4444-4444-8444-444444444444",
        },
      }),
    );
    strictEqual(response.status, 422);
    const body = await response.json();
    strictEqual(body.code, "GATEWAY_CANCEL_FAILED");
    strictEqual(stub.payments.length, 0);
    strictEqual(state.calls.includes("rpc:reopen_charge_for_reissue"), false);
    strictEqual(state.claimed, false);
  } finally {
    stub.restore();
  }
});

Deno.test("reemissão: cobrança paga => 409 CHARGE_NOT_PENDING sem novo POST", async () => {
  const state = baseState({
    reserve: { data: null, error: { code: "PT409", message: "CHARGE_NOT_PENDING" } },
    charge: { id: "ch-paid", amount_cents: 3000, status: "pago", asaas_payment_id: "pay-paid" },
  });
  const stub = stubAsaas();
  try {
    const response = await handlerFor(state)(
      request({
        body: {
          appointment_id: APPOINTMENT_ID,
          amount_cents: 3000,
          idempotency_key: "55555555-5555-4555-8555-555555555555",
        },
      }),
    );
    strictEqual(response.status, 409);
    const body = await response.json();
    strictEqual(body.code, "CHARGE_NOT_PENDING");
    strictEqual(stub.payments.length, 0);
    strictEqual(stub.deletes.length, 0);
  } finally {
    stub.restore();
  }
});

Deno.test("claim perdido no attach: cancela o payment criado e devolve 409 GATEWAY_IN_PROGRESS", async () => {
  const state = baseState({
    attach: { data: null, error: { code: "PT409", message: "GATEWAY_CLAIM_LOST" } },
  });
  const stub = stubAsaas();
  try {
    const response = await handlerFor(state)(
      request({
        body: {
          appointment_id: APPOINTMENT_ID,
          amount_cents: 3000,
          idempotency_key: "66666666-6666-4666-8666-666666666666",
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
  const state = baseState({
    attach: { data: null, error: { code: "PT409", message: "GATEWAY_CLAIM_LOST" } },
  });
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
          amount_cents: 3000,
          idempotency_key: "88888888-8888-4888-8888-888888888888",
        },
      }),
    );
    strictEqual(response.status, 200);
    const body = await response.json();
    strictEqual(body.charge_id, "ch1");
    strictEqual(body.pix_qr_code, "qr-winner");
    strictEqual(stub.payments.length, 1);
    strictEqual(stub.deletes.length, 0);
  } finally {
    stub.restore();
  }
});

Deno.test("poll esgotado no claim: 1 único POST e o perdedor recebe 409 GATEWAY_IN_PROGRESS", async () => {
  Deno.env.set("GATEWAY_CLAIM_WAIT_MS", "0");
  const state = baseState();
  const stub = stubAsaas(300);
  try {
    const handler = handlerFor(state);
    const call = () =>
      handler(
        request({
          body: {
            appointment_id: APPOINTMENT_ID,
            amount_cents: 3000,
            idempotency_key: "77777777-7777-4777-8777-777777777777",
          },
        }),
      );

    const [first, second] = await Promise.all([call(), call()]);
    const statuses = [first.status, second.status].sort((a, b) => a - b);
    strictEqual(statuses[0], 200);
    strictEqual(statuses[1], 409);

    const loser = first.status === 409 ? first : second;
    const loserBody = await loser.json();
    strictEqual(loserBody.code, "GATEWAY_IN_PROGRESS");
    strictEqual(loserBody.retryable, true);
    strictEqual(stub.payments.length, 1);
  } finally {
    stub.restore();
    Deno.env.delete("GATEWAY_CLAIM_WAIT_MS");
  }
});

Deno.test("release recusado por claim de outro criador: não vira 500, segue com 422 GATEWAY_ERROR", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    throw new TypeError("network down");
  }) as typeof fetch;
  const state = baseState();
  try {
    const service = fakeService(state);
    const originalRpc = (service as unknown as { rpc: Function }).rpc;
    (service as unknown as { rpc: Function }).rpc = async (name: string, args: Row) => {
      if (name === "release_charge_reservation") {
        return { data: null, error: { code: "PT409", message: "GATEWAY_IN_PROGRESS" } };
      }
      return originalRpc(name, args);
    };
    const handler = createHandler({ createService: () => service });
    const response = await handler(
      request({ body: { appointment_id: APPOINTMENT_ID, amount_cents: 3000 } }),
    );
    strictEqual(response.status, 422);
    const body = await response.json();
    strictEqual(body.code, "GATEWAY_ERROR");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("falha ao liberar a reserva (RPC) vira 500 e não engole o erro", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    throw new TypeError("network down");
  }) as typeof fetch;
  const state = baseState();
  try {
    const failingService = fakeService(state);
    const originalRpc = (failingService as unknown as { rpc: Function }).rpc;
    (failingService as unknown as { rpc: Function }).rpc = async (name: string, args: Row) => {
      if (name === "release_charge_reservation") {
        return { data: null, error: { code: "23503", message: "fk" } };
      }
      return originalRpc(name, args);
    };
    const handler = createHandler({ createService: () => failingService });
    const response = await handler(
      request({ body: { appointment_id: APPOINTMENT_ID, amount_cents: 3000 } }),
    );
    strictEqual(response.status, 500);
    const body = await response.json();
    strictEqual(body.code, "INTERNAL");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
