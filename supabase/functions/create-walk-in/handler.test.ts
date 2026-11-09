import { strictEqual } from "node:assert/strict";
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { createHandler } from "./handler.ts";

type Row = Record<string, unknown>;

const TENANT = "22222222-2222-2222-2222-222222222222";
const PROFESSIONAL = "44444444-4444-4444-4444-444444444444";
const SERVICE = "55555555-5555-5555-5555-555555555555";
const KEY = "66666666-6666-6666-6666-666666666666";

interface FakeState {
  segment: string;
  linked: boolean;
  rpc: (name: string, args: Row) => { data: unknown; error: { code: string; message: string } | null };
}

function builder(table: string, state: FakeState): any {
  const query: any = {
    select: () => query,
    eq: () => query,
    maybeSingle: async () => {
      if (table === "tenants") return { data: { segment: state.segment }, error: null };
      if (table === "service_professionals") {
        return { data: state.linked ? { id: "link-1" } : null, error: null };
      }
      return { data: null, error: null };
    },
  };
  return query;
}

function fakeService(state: FakeState): SupabaseClient {
  return {
    auth: {
      getUser: async () => ({ data: { user: { id: "u1" } }, error: null }),
    },
    from: (table: string) => builder(table, state),
    rpc: async (name: string, args: Row) => state.rpc(name, args),
  } as unknown as SupabaseClient;
}

function profile(role = "admin"): Row {
  return { id: "u1", tenant_id: TENANT, role, active: true };
}

async function post(body: unknown, state: FakeState, role = "admin") {
  const handler = createHandler({
    createService: () => {
      const service = fakeService(state);
      const origFrom = service.from.bind(service);
      (service as any).from = (table: string) => {
        if (table === "profiles") {
          return {
            select: () => ({
              eq: () => ({ maybeSingle: async () => ({ data: profile(role), error: null }) }),
            }),
          };
        }
        return origFrom(table);
      };
      return service;
    },
  });
  const res = await handler(
    new Request("http://local/", {
      method: "POST",
      headers: { Authorization: "Bearer token" },
      body: JSON.stringify(body),
    }),
  );
  return { status: res.status, json: (await res.json()) as Row };
}

Deno.test("cria walk-in e devolve appointment_id", async () => {
  const { status, json } = await post(
    { professional_id: PROFESSIONAL, service_id: SERVICE, creation_idempotency_key: KEY },
    {
      segment: "barbearia",
      linked: true,
      rpc: () => ({ data: { id: "appt-1", reused: false }, error: null }),
    },
  );
  strictEqual(status, 201);
  strictEqual(json.appointment_id, "appt-1");
});

Deno.test("recusa fora do ramo com SEGMENT_NOT_ENABLED", async () => {
  const { status, json } = await post(
    { professional_id: PROFESSIONAL, service_id: SERVICE, creation_idempotency_key: KEY },
    { segment: "clinica", linked: true, rpc: () => ({ data: {}, error: null }) },
  );
  strictEqual(status, 409);
  strictEqual(json.code, "SEGMENT_NOT_ENABLED");
});

Deno.test("recusa serviço não oferecido com SERVICE_NOT_OFFERED", async () => {
  const { status, json } = await post(
    { professional_id: PROFESSIONAL, service_id: SERVICE, creation_idempotency_key: KEY },
    { segment: "salao", linked: false, rpc: () => ({ data: {}, error: null }) },
  );
  strictEqual(status, 409);
  strictEqual(json.code, "SERVICE_NOT_OFFERED");
});

Deno.test("replay da mesma chave devolve existente (200)", async () => {
  const { status, json } = await post(
    { professional_id: PROFESSIONAL, service_id: SERVICE, creation_idempotency_key: KEY },
    {
      segment: "barbearia",
      linked: true,
      rpc: () => ({ data: { id: "appt-1", reused: true }, error: null }),
    },
  );
  strictEqual(status, 200);
  strictEqual(json.reused, true);
});

Deno.test("rejeita corpo inválido sem chamar o RPC", async () => {
  let rpcCalled = false;
  const { status } = await post(
    { professional_id: "nao-uuid" },
    {
      segment: "barbearia",
      linked: true,
      rpc: () => {
        rpcCalled = true;
        return { data: {}, error: null };
      },
    },
  );
  strictEqual(status, 400);
  strictEqual(rpcCalled, false);
});
