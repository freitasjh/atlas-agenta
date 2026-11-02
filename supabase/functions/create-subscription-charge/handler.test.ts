import { strictEqual } from "node:assert/strict";
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { createHandler } from "./handler.ts";

Deno.env.set("ASAAS_SUPER_ADMIN_API_KEY","key");
Deno.env.set("ASAAS_SUPER_ADMIN_ENVIRONMENT","sandbox");

const TOKEN = "jwt-teste";
function baseService(overrides: any = {}) {
  const svc: any = {
    auth: { getUser: async () => ({ data: { user: { id: "u1" } }, error: null }) },
    from: (table: string) => {
      if (table === "profiles") return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { tenant_id: null, role: "super_admin" }, error: null }) }) }) };
      if (table === "tenants") return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { name: "Tenant" }, error: null }) }) }) };
      if (table === "subscription_charges") return { insert: () => ({ select: () => ({ single: async () => ({ data: { id: "sc1" }, error: overrides.insErr ?? null }) }) }) };
      if (table === "audit_log") return { insert: async () => ({ error: overrides.auditErr ?? null }) };
      return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }), insert: async () => ({ error: null }) };
    },
  };
  return svc as SupabaseClient;
}
function build(overrides: any = {}, throws = false) {
  const svc = baseService(overrides);
  return createHandler({ createService: () => { if (throws) throw new Error("cfg"); return svc; } });
}
function call(handler: any, init: any = {}) {
  return handler(new Request("http://localhost/functions/v1/create-subscription-charge", {
    method: init.method ?? "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${init.token ?? TOKEN}` },
    body: (init.method ?? "POST") === "GET" ? undefined : JSON.stringify(init.body ?? { tenant_id: "11111111-1111-4111-8111-111111111111", plan: "individual", billing_period: "monthly" }),
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
  const r=await (h as any)(new Request("http://x",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({tenant_id:"11111111-1111-4111-8111-111111111111",plan:"individual"})}));
  strictEqual(r.status,401);
});
Deno.test("invalid body 400", async () => { const h=build(); const r=await call(h,{body:{}}); strictEqual(r.status,400); });
Deno.test("non super_admin 401", async () => {
  const svc: any = baseService();
  svc.from = (t: string) => t === "profiles" ? { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { tenant_id: "t1", role: "admin" }, error: null }) }) }) } : svc.from(t);
  const h = createHandler({ createService: () => svc });
  const r = await call(h);
  strictEqual(r.status, 401);
});
Deno.test("success 200", async () => {
  const orig=globalThis.fetch;
  globalThis.fetch = async (url: any) => {
    const u=String(url);
    if (u.endsWith("/customers")) return new Response(JSON.stringify({id:"cus1"}),{status:200}) as any;
    if (u.endsWith("/payments")) return new Response(JSON.stringify({id:"pay1"}),{status:200}) as any;
    if (u.includes("/pixQrCode")) return new Response(JSON.stringify({encodedImage:"qr",payload:"copy"}),{status:200}) as any;
    return new Response("{}",{status:200}) as any;
  };
  try {
    const h=build();
    const r=await call(h);
    strictEqual(r.status,200);
  } finally { globalThis.fetch=orig; }
});
