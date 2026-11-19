import { strictEqual } from "node:assert/strict";
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { createHandler, currentMonthBoundsUtc } from "./handler.ts";

Deno.env.set("ASAAS_SUPER_ADMIN_API_KEY", "key");
Deno.env.set("ASAAS_SUPER_ADMIN_ENVIRONMENT", "sandbox");

const TOKEN = "jwt-teste";
const TENANT = "11111111-1111-4111-8111-111111111111";

interface State {
  role?: string;
  tenant?: Record<string, unknown> | null;
  catalog?: Record<string, { price_cents: number }>;
  currentFeatures?: string[];
  existingCharge?: Record<string, unknown> | null;
  insErr?: unknown;
  auditErr?: unknown;
  rpcErr?: unknown;
  rpcCalls?: string[];
  profCount?: number;
  apptCount?: number;
  capturedApptFilters?: Array<[string, unknown, unknown]>;
  profLimit?: number | null;
  apptLimit?: number | null;
  effectiveAt?: string;
  inserted?: unknown[];
}

const DEFAULT_CATALOG: Record<string, { price_cents: number }> = {
  free: { price_cents: 0 },
  starter: { price_cents: 5900 },
  premium: { price_cents: 14900 },
  enterprise: { price_cents: 25900 },
};

function baseService(state: State = {}) {
  state.rpcCalls ??= [];
  state.inserted ??= [];
  const svc: any = {
    auth: {
      getUser: async () => ({ data: { user: { id: "u1" } }, error: null }),
    },
    rpc: async (fn: string, _params: unknown) => {
      state.rpcCalls!.push(fn);
      if (fn === "next_cycle_start_utc") {
        return { data: state.effectiveAt ?? "2030-02-01T03:00:00.000Z", error: null };
      }
      if (fn === "plan_professional_limit") return { data: state.profLimit ?? null, error: null };
      if (fn === "plan_appointment_limit") return { data: state.apptLimit ?? null, error: null };
      if (fn === "apply_subscription_payment") {
        return { data: { applied: true }, error: state.rpcErr ?? null };
      }
      return { data: null, error: null };
    },
    from: (table: string) => {
      if (table === "profiles") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: { tenant_id: TENANT, role: state.role ?? "admin" },
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === "tenants") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: state.tenant ?? {
                  plan: "starter",
                  subscription_status: "ativo",
                  timezone: "America/Sao_Paulo",
                  trade_name: "Tenant",
                  owner_email: "t@teste.invalido",
                },
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === "plans") {
        const pairs: Array<[string, unknown]> = [];
        const filter: any = {
          eq: (column: string, value: unknown) => {
            pairs.push([column, value]);
            return filter;
          },
          maybeSingle: async () => {
            const slug = pairs.find(([c]) => c === "slug")?.[1];
            const byActive = pairs.some(([c]) => c === "active");
            if (byActive) {
              const row = (state.catalog ?? DEFAULT_CATALOG)[String(slug)];
              if (!row) return { data: null, error: null };
              return { data: { slug, price_cents: row.price_cents, features: [] }, error: null };
            }
            return { data: { features: state.currentFeatures ?? ["checkout_self_service"] }, error: null };
          },
        };
        return { select: () => filter };
      }
      if (table === "subscription_charges") {
        return {
          select: () => ({
            eq: (_c: string, _v: unknown) => ({
              eq: (_c2: string, _v2: unknown) => ({
                maybeSingle: async () => ({ data: state.existingCharge ?? null, error: null }),
              }),
            }),
          }),
          insert: (row: unknown) => {
            state.inserted!.push(row);
            return {
              select: () => ({
                single: async () => ({ data: { id: "sc1" }, error: state.insErr ?? null }),
              }),
            };
          },
        };
      }
      if (table === "professionals" || table === "appointments") {
        const n = table === "professionals" ? (state.profCount ?? 0) : (state.apptCount ?? 0);
        const calls: Array<[string, unknown, unknown]> = [];
        if (table === "appointments") state.capturedApptFilters = calls;
        const chain: any = {
          eq: (c: string, v: unknown) => { calls.push(["eq", c, v]); return chain; },
          neq: (c: string, v: unknown) => { calls.push(["neq", c, v]); return chain; },
          gte: (c: string, v: unknown) => { calls.push(["gte", c, v]); return chain; },
          lt: (c: string, v: unknown) => { calls.push(["lt", c, v]); return chain; },
          then: (resolve: any, reject: any) =>
            Promise.resolve({ count: n, error: null }).then(resolve, reject),
        };
        return { select: () => chain };
      }
      if (table === "audit_log") return { insert: async () => ({ error: state.auditErr ?? null }) };
      return {
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
        insert: async () => ({ error: null }),
      };
    },
  };
  return svc as SupabaseClient;
}

function build(state: State = {}, throws = false) {
  const svc = baseService(state);
  return createHandler({ createService: () => { if (throws) throw new Error("cfg"); return svc; } });
}

function call(handler: any, init: any = {}) {
  return handler(new Request("http://localhost/functions/v1/create-checkout", {
    method: init.method ?? "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${init.token ?? TOKEN}` },
    body: (init.method ?? "POST") === "GET" ? undefined : JSON.stringify(init.body ?? { plan: "premium" }),
  }));
}

function stubAsaas(opts: { paymentsFail?: boolean } = {}) {
  const orig = globalThis.fetch;
  const payments: any[] = [];
  globalThis.fetch = async (url: any, init?: any) => {
    const u = String(url);
    if (u.includes("/customers?externalReference=")) {
      return new Response(JSON.stringify({ data: [] }), { status: 200 }) as any;
    }
    if (u.endsWith("/customers")) {
      return new Response(JSON.stringify({ id: "cus1" }), { status: 200 }) as any;
    }
    if (u.endsWith("/payments")) {
      if (opts.paymentsFail) return new Response("{}", { status: 500 }) as any;
      payments.push(JSON.parse(init?.body ?? "{}"));
      return new Response(JSON.stringify({ id: "pay1" }), { status: 200 }) as any;
    }
    if (u.includes("/pixQrCode")) {
      return new Response(JSON.stringify({ encodedImage: "qr", payload: "copy" }), { status: 200 }) as any;
    }
    return new Response("{}", { status: 200 }) as any;
  };
  return { payments, restore: () => { globalThis.fetch = orig; } };
}

Deno.test("OPTIONS", async () => {
  let c = 0;
  const h = createHandler({ createService: () => { c++; return baseService(); } });
  const r = await (h as any)(new Request("http://x", { method: "OPTIONS" }));
  strictEqual(r.status, 200);
  strictEqual(c, 0);
});
Deno.test("GET 405", async () => { const r = await call(build(), { method: "GET" }); strictEqual(r.status, 405); });
Deno.test("throws 500", async () => { const r = await call(build({}, true)); strictEqual(r.status, 500); });
Deno.test("no token 401", async () => {
  const h = build();
  const r = await (h as any)(new Request("http://x", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ plan: "premium" }),
  }));
  strictEqual(r.status, 401);
});
Deno.test("professional 403", async () => {
  const r = await call(build({ role: "professional" }));
  strictEqual(r.status, 403);
});
Deno.test("receptionist 403", async () => {
  const r = await call(build({ role: "receptionist" }));
  strictEqual(r.status, 403);
});
Deno.test("invalid body 400", async () => { const r = await call(build(), { body: {} }); strictEqual(r.status, 400); });
Deno.test("cancelado 403", async () => {
  const r = await call(
    build({ tenant: { plan: "starter", subscription_status: "cancelado", timezone: "America/Sao_Paulo" } }),
  );
  strictEqual(r.status, 403);
  strictEqual((await r.json()).code, "SUBSCRIPTION_CANCELLED");
});
Deno.test("plano inexistente 400", async () => {
  const r = await call(build(), { body: { plan: "plano_inexistente" } });
  strictEqual(r.status, 400);
});
Deno.test("mesmo plano 400", async () => {
  const r = await call(build(), { body: { plan: "starter" } });
  strictEqual(r.status, 400);
  strictEqual((await r.json()).code, "ALREADY_ON_PLAN");
});
Deno.test("sem entitlement 403 upsell", async () => {
  const r = await call(build({ currentFeatures: ["agendamento"] }));
  strictEqual(r.status, 403);
  strictEqual((await r.json()).code, "UPSELL");
});

Deno.test("upgrade 200 com pix e sem effective_at", async () => {
  const stub = stubAsaas();
  try {
    const state: State = {};
    const r = await call(build(state));
    strictEqual(r.status, 200);
    const body = await r.json();
    strictEqual(body.kind, "upgrade");
    strictEqual(body.pix_qr_code, "qr");
    strictEqual(body.pix_copy_paste, "copy");
    strictEqual(body.effective_at, null);
    strictEqual(stub.payments.length, 1);
    strictEqual(stub.payments[0]?.value, 149);
  } finally { stub.restore(); }
});

Deno.test("downgrade 200 agenda fim do ciclo", async () => {
  const stub = stubAsaas();
  try {
    const state: State = {
      tenant: { plan: "premium", subscription_status: "ativo", timezone: "America/Sao_Paulo", trade_name: "T", owner_email: "t@t" },
      profLimit: 5,
      apptLimit: null,
    };
    const h = build(state);
    const r = await call(h, { body: { plan: "starter" } });
    strictEqual(r.status, 200);
    const body = await r.json();
    strictEqual(body.kind, "downgrade");
    strictEqual(body.effective_at, "2030-02-01T03:00:00.000Z");
    strictEqual(state.rpcCalls!.includes("next_cycle_start_utc"), true);
  } finally { stub.restore(); }
});

Deno.test("downgrade acima do limite 409", async () => {
  const state: State = {
    tenant: { plan: "premium", subscription_status: "ativo", timezone: "America/Sao_Paulo", trade_name: "T", owner_email: "t@t" },
    profCount: 2,
    profLimit: 1,
  };
  const h = build(state);
  const r = await call(h, { body: { plan: "starter" } });
  strictEqual(r.status, 409);
  strictEqual((await r.json()).code, "PLAN_LIMIT");
});

Deno.test("idempotency_key repetida devolve existente", async () => {
  const state: State = {
    existingCharge: {
      id: "sc-old", status: "pendente", amount_cents: 14900, plan: "premium",
      kind: "upgrade", pix_qr_code: "qr", pix_copy_paste: "copy",
      expires_at: "2030-01-01T00:00:00.000Z", effective_at: null,
    },
  };
  const h = build(state);
  const r = await call(h, { body: { plan: "premium", idempotency_key: "123e4567-e89b-12d3-a456-426614174000" } });
  strictEqual(r.status, 200);
  const body = await r.json();
  strictEqual(body.charge_id, "sc-old");
  strictEqual(body.replayed, true);
});

Deno.test("downgrade para free agenda sem gateway", async () => {
  const state: State = {
    tenant: { plan: "starter", subscription_status: "ativo", timezone: "America/Sao_Paulo", trade_name: "T", owner_email: "t@t" },
    profLimit: 1,
    apptLimit: 30,
  };
  const h = build(state);
  const r = await call(h, { body: { plan: "free" } });
  strictEqual(r.status, 200);
  const body = await r.json();
  strictEqual(body.scheduled, true);
  strictEqual(body.kind, "downgrade");
  strictEqual(state.rpcCalls!.includes("apply_subscription_payment"), true);
});

Deno.test("falha no gateway 500", async () => {
  const stub = stubAsaas({ paymentsFail: true });
  try {
    const r = await call(build());
    strictEqual(r.status, 500);
  } finally { stub.restore(); }
});

Deno.test("currentMonthBoundsUtc janeiro Sao_Paulo", () => {
  const b = currentMonthBoundsUtc("America/Sao_Paulo", new Date("2030-01-15T12:00:00.000Z"));
  strictEqual(b.start, "2030-01-01T03:00:00.000Z");
  strictEqual(b.end, "2030-02-01T03:00:00.000Z");
});

Deno.test("currentMonthBoundsUtc virada de ano", () => {
  const b = currentMonthBoundsUtc("America/Sao_Paulo", new Date("2030-12-15T12:00:00.000Z"));
  strictEqual(b.start, "2030-12-01T03:00:00.000Z");
  strictEqual(b.end, "2031-01-01T03:00:00.000Z");
});

Deno.test("downgrade escopa agendamentos ao mes vigente (gte/lt)", async () => {
  const stub = stubAsaas();
  try {
    const state: State = {
      tenant: { plan: "premium", subscription_status: "ativo", timezone: "America/Sao_Paulo", trade_name: "T", owner_email: "t@t" },
      apptCount: 120,
      apptLimit: 150,
    };
    const h = build(state);
    const r = await call(h, { body: { plan: "starter" } });
    strictEqual(r.status, 200);
    const filters = state.capturedApptFilters ?? [];
    const gte = filters.find(([op, col]) => op === "gte" && col === "starts_at");
    const lt = filters.find(([op, col]) => op === "lt" && col === "starts_at");
    strictEqual(gte !== undefined, true);
    strictEqual(lt !== undefined, true);
    const expected = currentMonthBoundsUtc("America/Sao_Paulo");
    strictEqual(gte![2], expected.start);
    strictEqual(lt![2], expected.end);
  } finally { stub.restore(); }
});
