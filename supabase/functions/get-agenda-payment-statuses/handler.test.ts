import { strictEqual, deepStrictEqual } from "node:assert/strict";
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { createHandler } from "./handler.ts";

const APPOINTMENT = "11111111-1111-4111-8111-111111111111";
const OTHER_APPOINTMENT = "22222222-2222-4222-8222-222222222222";

type Row = Record<string, unknown>;

interface FakeState {
  profile: Row | null;
  user: { id: string } | null;
  professional: Row | null;
  rpcRows: Row[];
  rpcArgs: Row | null;
  rpcCalls: number;
  filters: Array<{ table: string; column: string; value: unknown }>;
}

function fakeState(overrides: Partial<FakeState> = {}): FakeState {
  return {
    profile: { tenant_id: "tenant-1", role: "admin", active: true },
    user: { id: "user-1" },
    professional: null,
    rpcRows: [{ appointment_id: APPOINTMENT, payment_status: "quitado" }],
    rpcArgs: null,
    rpcCalls: 0,
    filters: [],
    ...overrides,
  };
}

function builder(table: string, state: FakeState): any {
  const query: any = {
    select: () => query,
    eq: (column: string, value: unknown) => {
      state.filters.push({ table, column, value });
      return query;
    },
    maybeSingle: async () => {
      if (table === "profiles") return { data: state.profile, error: null };
      if (table === "professionals") return { data: state.professional, error: null };
      return { data: null, error: null };
    },
  };
  return query;
}

function fakeService(state: FakeState): SupabaseClient {
  return {
    auth: {
      getUser: async () => {
        if (state.user === null) return { data: { user: null }, error: { message: "invalid" } };
        return { data: { user: state.user }, error: null };
      },
    },
    from: (table: string) => builder(table, state),
    rpc: async (_name: string, args: Row) => {
      state.rpcCalls += 1;
      state.rpcArgs = args;
      return { data: state.rpcRows, error: null };
    },
  } as unknown as SupabaseClient;
}

function request(body: unknown, token = "token"): Request {
  return new Request("http://local/get-agenda-payment-statuses", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
}

async function call(state: FakeState, body: unknown, token = "token") {
  const handler = createHandler({ createService: () => fakeService(state) });
  const response = await handler(request(body, token));
  return { status: response.status, json: await response.json() };
}

Deno.test("admin recebe somente appointment_id/payment_status", async () => {
  const state = fakeState({
    rpcRows: [
      {
        appointment_id: APPOINTMENT,
        payment_status: "parcial",
        amount_cents: 5_000,
        remaining_cents: 1_000,
        pix_qr_code: "segredo",
      },
    ],
  });
  const { status, json } = await call(state, { appointment_ids: [APPOINTMENT] });

  strictEqual(status, 200);
  deepStrictEqual(json, {
    statuses: [{ appointment_id: APPOINTMENT, payment_status: "parcial" }],
  });
  deepStrictEqual(state.rpcArgs, {
    p_tenant_id: "tenant-1",
    p_appointment_ids: [APPOINTMENT],
    p_professional_id: null,
    p_actor_id: "user-1",
  });
});

Deno.test("profissional envia o próprio professionals.id e o ator ao RPC", async () => {
  const state = fakeState({
    profile: { tenant_id: "tenant-1", role: "professional", active: true },
    professional: { id: "prof-1" },
  });
  const { status } = await call(state, { appointment_ids: [APPOINTMENT] });

  strictEqual(status, 200);
  strictEqual(state.rpcArgs?.p_professional_id, "prof-1");
  strictEqual(state.rpcArgs?.p_actor_id, "user-1");
});

Deno.test("profissional com atendimento alheio => 200 vazio, sem pré-check de vínculo", async () => {
  const state = fakeState({
    profile: { tenant_id: "tenant-1", role: "professional", active: true },
    professional: { id: "prof-1" },
    rpcRows: [],
  });
  const { status, json } = await call(state, { appointment_ids: [OTHER_APPOINTMENT] });

  strictEqual(status, 200);
  deepStrictEqual(json, { statuses: [] });
  strictEqual(state.rpcCalls, 1);
  deepStrictEqual(
    state.filters.filter((filter) => filter.table === "appointments"),
    [],
  );
});

Deno.test("profissional sem vínculo em professionals => 403", async () => {
  const state = fakeState({
    profile: { tenant_id: "tenant-1", role: "professional", active: true },
    professional: null,
  });
  const { status, json } = await call(state, { appointment_ids: [APPOINTMENT] });

  strictEqual(status, 403);
  strictEqual((json as Row).code, "PROFESSIONAL_NOT_OWNER");
  strictEqual(state.rpcCalls, 0);
});

Deno.test("tenant_id/role no corpo => 400 INVALID_BODY", async () => {
  const state = fakeState();
  for (const body of [
    { appointment_ids: [APPOINTMENT], tenant_id: "tenant-1" },
    { appointment_ids: [APPOINTMENT], role: "admin" },
  ]) {
    const { status, json } = await call(state, body);
    strictEqual(status, 400);
    strictEqual((json as Row).code, "INVALID_BODY");
  }
  strictEqual(state.rpcCalls, 0);
});

Deno.test("lote de 201 ids => 400 INVALID_BODY; 200 ids distintos chamam a RPC", async () => {
  const ids = Array.from({ length: 200 }, () => crypto.randomUUID());
  strictEqual(new Set(ids).size, 200);

  const tooMany = fakeState();
  const rejected = await call(tooMany, { appointment_ids: [...ids, OTHER_APPOINTMENT] });
  strictEqual(rejected.status, 400);
  strictEqual(tooMany.rpcCalls, 0);

  const accepted = fakeState();
  const ok = await call(accepted, { appointment_ids: ids });
  strictEqual(ok.status, 200);
  strictEqual(accepted.rpcCalls, 1);
  deepStrictEqual(accepted.rpcArgs?.p_appointment_ids, ids);
});

Deno.test("sem JWT => 401; GET => 405", async () => {
  const state = fakeState({ user: null });
  const unauthenticated = await call(state, { appointment_ids: [APPOINTMENT] });
  strictEqual(unauthenticated.status, 401);

  const handler = createHandler({ createService: () => fakeService(fakeState()) });
  const response = await handler(
    new Request("http://local/get-agenda-payment-statuses", { method: "GET" }),
  );
  strictEqual(response.status, 405);
});

Deno.test("papel fora da matriz => 403", async () => {
  const state = fakeState({
    profile: { tenant_id: "tenant-1", role: "super_admin", active: true },
  });
  const { status, json } = await call(state, { appointment_ids: [APPOINTMENT] });
  strictEqual(status, 403);
  strictEqual((json as Row).code, "FORBIDDEN");
});

Deno.test("linhas inválidas do RPC não viram status", async () => {
  const state = fakeState({
    rpcRows: [
      { appointment_id: APPOINTMENT },
      { appointment_id: null, payment_status: "quitado" },
      { appointment_id: OTHER_APPOINTMENT, payment_status: "sem_pagamento" },
    ],
  });
  const { status, json } = await call(state, { appointment_ids: [APPOINTMENT, OTHER_APPOINTMENT] });
  strictEqual(status, 200);
  deepStrictEqual(json, {
    statuses: [{ appointment_id: OTHER_APPOINTMENT, payment_status: "sem_pagamento" }],
  });
});
