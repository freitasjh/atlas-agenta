import { strictEqual } from "node:assert/strict";
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { createHandler } from "./handler.ts";

Deno.env.set("ASAAS_SUPER_ADMIN_API_KEY","key");
Deno.env.set("ASAAS_SUPER_ADMIN_ENVIRONMENT","sandbox");

const TOKEN = "jwt-teste";

/**
 * Preços do catálogo SSoT `public.plans` (espelho do seed da migration T1.0).
 * O handler não conhece estes valores: o mock devolve o que a tabela teria.
 */
const PLAN_PRICES: Record<string, number> = {
  starter: 5900,
  premium: 14900,
  enterprise: 25900,
  free: 0,
};

interface ServiceOverrides {
  insErr?: unknown;
  auditErr?: unknown;
  planPrices?: Record<string, number>;
  plansError?: unknown;
}

function baseService(overrides: ServiceOverrides = {}) {
  const prices = overrides.planPrices ?? PLAN_PRICES;
  const svc: any = {
    auth: { getUser: async () => ({ data: { user: { id: "u1" } }, error: null }) },
    from: (table: string) => {
      if (table === "profiles") return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { tenant_id: null, role: "super_admin" }, error: null }) }) }) };
      if (table === "tenants") return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { name: "Tenant" }, error: null }) }) }) };
      if (table === "plans") {
        let slug: string | null = null;
        let active: boolean | null = null;
        const filter: any = {
          eq: (column: string, value: unknown) => {
            if (column === "slug") slug = String(value);
            if (column === "active") active = Boolean(value);
            return filter;
          },
          maybeSingle: async () => {
            if (overrides.plansError) return { data: null, error: overrides.plansError };
            if (slug === null || active !== true) return { data: null, error: null };
            const price = prices[slug];
            if (price === undefined) return { data: null, error: null };
            return { data: { price_cents: price }, error: null };
          },
        };
        return { select: () => filter };
      }
      if (table === "subscription_charges") return { insert: () => ({ select: () => ({ single: async () => ({ data: { id: "sc1" }, error: overrides.insErr ?? null }) }) }) };
      if (table === "audit_log") return { insert: async () => ({ error: overrides.auditErr ?? null }) };
      return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }), insert: async () => ({ error: null }) };
    },
  };
  return svc as SupabaseClient;
}
function build(overrides: ServiceOverrides = {}, throws = false) {
  const svc = baseService(overrides);
  return createHandler({ createService: () => { if (throws) throw new Error("cfg"); return svc; } });
}
function call(handler: any, init: any = {}) {
  return handler(new Request("http://localhost/functions/v1/create-subscription-charge", {
    method: init.method ?? "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${init.token ?? TOKEN}` },
    body: (init.method ?? "POST") === "GET" ? undefined : JSON.stringify(init.body ?? { tenant_id: "11111111-1111-4111-8111-111111111111", plan: "starter", billing_period: "monthly" }),
  }));
}

Deno.test("OPTIONS", async () => {
  let c=0; const h=createHandler({createService:()=>{c++;return baseService();}});
  const r=await (h as any)(new Request("http://x",{method:"OPTIONS"}));
  strictEqual(r.status,200); strictEqual(c,0);
});
Deno.test("GET 405", async () => { const h=build(); const r=await call(h,{method:"GET"}); strictEqual(r.status,405); });
Deno.test("throws 500", async () => { const h=build({},true); const r=await call(h); strictEqual(r.status,500); });
Deno.test("no token 401", async () => {
  const h=build();
  const r=await (h as any)(new Request("http://x",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({tenant_id:"11111111-1111-4111-8111-111111111111",plan:"starter"})}));
  strictEqual(r.status,401);
});
Deno.test("invalid body 400", async () => { const h=build(); const r=await call(h,{body:{}}); strictEqual(r.status,400); });
Deno.test("non super_admin 403", async () => {
  const svc: any = baseService();
  svc.from = (t: string) => t === "profiles" ? { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { tenant_id: "t1", role: "admin" }, error: null }) }) }) } : svc.from(t);
  const h = createHandler({ createService: () => svc });
  const r = await call(h);
  strictEqual(r.status, 403);
});
function stubAsaas(opts: { existingCustomer?: string } = {}) {
  const orig = globalThis.fetch;
  const payments: any[] = [];
  const created: any[] = [];
  globalThis.fetch = async (url: any, init?: any) => {
    const u=String(url);
    if (u.includes("/customers?externalReference=")) {
      const data = opts.existingCustomer ? [{ id: opts.existingCustomer }] : [];
      return new Response(JSON.stringify({data}),{status:200}) as any;
    }
    if (u.endsWith("/customers")) { created.push(JSON.parse(init?.body ?? "{}")); return new Response(JSON.stringify({id:"cus1"}),{status:200}) as any; }
    if (u.endsWith("/payments")) { payments.push(JSON.parse(init?.body ?? "{}")); return new Response(JSON.stringify({id:"pay1"}),{status:200}) as any; }
    if (u.includes("/pixQrCode")) return new Response(JSON.stringify({encodedImage:"qr",payload:"copy"}),{status:200}) as any;
    return new Response("{}",{status:200}) as any;
  };
  return { payments, created, restore: () => { globalThis.fetch = orig; } };
}

Deno.test("success 200", async () => {
  const stub = stubAsaas();
  try {
    const h=build();
    const r=await call(h);
    strictEqual(r.status,200);
    strictEqual(stub.created.length, 1);
    strictEqual(stub.created[0]?.externalReference, "11111111-1111-4111-8111-111111111111");
  } finally { stub.restore(); }
});

Deno.test("reaproveita customer existente pelo externalReference", async () => {
  const stub = stubAsaas({ existingCustomer: "cus-salvo" });
  try {
    const h = build();
    const r = await call(h);
    strictEqual(r.status, 200);
    strictEqual(stub.created.length, 0);
    strictEqual(stub.payments.length, 1);
    strictEqual(stub.payments[0]?.customer, "cus-salvo");
  } finally { stub.restore(); }
});

// O preço vem da tabela `plans` (SSoT T1.0). Os literais abaixo travam o valor
// cobrado ponta a ponta — se o seed mudar, o teste acompanha por decisão.
const PAID_PLANS: Record<string, number> = {
  starter: 5900,
  premium: 14900,
  enterprise: 25900,
};
for (const [plan, cents] of Object.entries(PAID_PLANS)) {
  Deno.test(`plan ${plan} cobra ${cents} centavos`, async () => {
    const stub = stubAsaas();
    try {
      const h = build();
      const r = await call(h, { body: { tenant_id: "11111111-1111-4111-8111-111111111111", plan, billing_period: "monthly" } });
      strictEqual(r.status, 200);
      strictEqual(stub.payments.length, 1);
      strictEqual(stub.payments[0]?.value, cents / 100);
    } finally { stub.restore(); }
  });
}

// Prova de que o preço é lido da tabela, não de constante no handler: mudar o
// retorno do mock muda o valor cobrado.
Deno.test("preço é lido da tabela plans (sem hardcode no handler)", async () => {
  const stub = stubAsaas();
  try {
    const h = build({ planPrices: { starter: 1234 } });
    const r = await call(h, { body: { tenant_id: "11111111-1111-4111-8111-111111111111", plan: "starter", billing_period: "monthly" } });
    strictEqual(r.status, 200);
    strictEqual(stub.payments[0]?.value, 12.34);
  } finally { stub.restore(); }
});

Deno.test("plano free (preço 0) é rejeitado 400", async () => {
  const h = build();
  const r = await call(h, { body: { tenant_id: "11111111-1111-4111-8111-111111111111", plan: "free", billing_period: "monthly" } });
  strictEqual(r.status, 400);
});

Deno.test("plano inexistente é rejeitado 400", async () => {
  const h = build();
  const r = await call(h, { body: { tenant_id: "11111111-1111-4111-8111-111111111111", plan: "plano_inexistente", billing_period: "monthly" } });
  strictEqual(r.status, 400);
});

Deno.test("erro ao ler o catálogo plans é 400", async () => {
  const h = build({ plansError: { message: "boom" } });
  const r = await call(h);
  strictEqual(r.status, 400);
});

Deno.test("período anual é rejeitado 400", async () => {
  const h = build();
  const r = await call(h, { body: { tenant_id: "11111111-1111-4111-8111-111111111111", plan: "starter", billing_period: "annual" } });
  strictEqual(r.status, 400);
});

Deno.test("ambiente do super admin ausente 500", async () => {
  const prev = Deno.env.get("ASAAS_SUPER_ADMIN_ENVIRONMENT");
  Deno.env.delete("ASAAS_SUPER_ADMIN_ENVIRONMENT");
  try {
    const h = build();
    const r = await call(h);
    strictEqual(r.status, 500);
  } finally {
    if (prev !== undefined) Deno.env.set("ASAAS_SUPER_ADMIN_ENVIRONMENT", prev);
  }
});
