import { deepStrictEqual, strictEqual } from "node:assert/strict";
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { createHandler } from "./handler.ts";

const TOKEN = "jwt-teste";

type FakeOpts = { user?: any; profile?: any; getUserError?: any };
function fakeService(opts: FakeOpts = {}) {
  const user = opts.user === undefined ? { id: "u1" } : opts.user;
  const service = {
    auth: { getUser: async () => opts.getUserError ? { data: { user: null }, error: opts.getUserError } : { data: { user }, error: null } },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: opts.profile ?? null, error: null }) }) }) }),
  };
  return service as unknown as SupabaseClient;
}
function build(opts: FakeOpts = {}, throws = false) {
  const svc = fakeService(opts);
  return createHandler({ createService: () => { if (throws) throw new Error("cfg"); return svc; } });
}
function call(handler: any, init: any = {}) {
  const headers: Record<string,string> = { "Content-Type": "application/json" };
  const token = init.token === undefined ? TOKEN : init.token;
  if (token !== null) headers.Authorization = `Bearer ${token}`;
  return handler(new Request("http://localhost/functions/v1/test-asaas-connection", {
    method: init.method ?? "POST",
    headers,
    body: (init.method ?? "POST") === "POST" ? JSON.stringify(init.body ?? { apiKey: "key", environment: "sandbox" }) : undefined,
  }));
}

Deno.test("OPTIONS preflight", async () => {
  let created = 0;
  const h = createHandler({ createService: () => { created++; return fakeService() as any; } });
  const r = await call(h, { method: "OPTIONS" });
  strictEqual(r.status, 200);
  strictEqual(created, 0);
});
Deno.test("método não-POST 405", async () => {
  const h = build();
  const r = await call(h, { method: "GET" });
  strictEqual(r.status, 405);
});
Deno.test("createService lança 500", async () => {
  const h = build({}, true);
  const r = await call(h);
  strictEqual(r.status, 500);
});
Deno.test("sem token 401", async () => {
  const h = build();
  const r = await call(h, { token: null });
  strictEqual(r.status, 401);
});
Deno.test("corpo inválido 400", async () => {
  const h = build({ profile: { tenant_id: "t1", role: "admin" } });
  const r = await call(h, { body: {} });
  strictEqual(r.status, 400);
});
Deno.test("perfil não admin 401", async () => {
  const h = build({ profile: { tenant_id: "t1", role: "professional" } });
  const r = await call(h);
  strictEqual(r.status, 401);
});
Deno.test("asaas ok 200", async () => {
  const orig = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ id: "acc", name: "Conta" }), { status: 200 }) as any;
  try {
    const h = build({ profile: { tenant_id: "t1", role: "admin" } });
    const r = await call(h);
    strictEqual(r.status, 200);
    const b = await r.json();
    strictEqual(b.ok, true);
  } finally { globalThis.fetch = orig; }
});
