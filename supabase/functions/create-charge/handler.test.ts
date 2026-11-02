import { strictEqual } from "node:assert/strict";
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { createHandler } from "./handler.ts";
import { encryptText } from "../_shared/asaas.ts";
Deno.env.set("ASAAS_MASTER_KEY","segredo");
const VALID_ENC = await encryptText("key");
Deno.env.set("ASAAS_MASTER_KEY","segredo");

const TOKEN = "jwt-teste";
function baseService(overrides: any = {}) {
  const svc: any = {
    auth: { getUser: async () => ({ data: { user: { id: "u1" } }, error: null }) },
    from: (table: string) => {
      if (table === "profiles") return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { tenant_id: "t1", role: "admin" }, error: null }) }) }) };
      if (table === "charges") return {
        select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: ("existing" in overrides) ? overrides.existing : null, error: null }) }) }) }),
        insert: () => ({ select: () => ({ single: async () => ({ data: { id: "ch1" }, error: overrides.insErr ?? null }) }) }),
      };
      if (table === "tenant_asaas_config") return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: ("cfg" in overrides) ? overrides.cfg : { active: true, environment: "sandbox", asaas_api_key_encrypted: VALID_ENC }, error: null }) }) }) };
      if (table === "appointments") return { select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: ("appt" in overrides) ? overrides.appt : { id: "a1", price_cents: 1000, status: "concluido", customer_id: "c1" }, error: null }) }) }) }) };
      if (table === "customers") return { select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: ("cust" in overrides) ? overrides.cust : { name: "Cli", email: null, phone: null }, error: null }) }) }) }) };
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
  return handler(new Request("http://localhost/functions/v1/create-charge", {
    method: init.method ?? "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${init.token ?? TOKEN}` },
    body: (init.method ?? "POST") === "GET" ? undefined : JSON.stringify(init.body ?? { appointment_id: "11111111-1111-4111-8111-111111111111" }),
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
  const r=await (h as any)(new Request("http://x",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({appointment_id:"11111111-1111-4111-8111-111111111111"})}));
  strictEqual(r.status,401);
});
Deno.test("invalid body 400", async () => { const h=build(); const r=await call(h,{body:{}}); strictEqual(r.status,400); });
Deno.test("config inactive 400", async () => { const h=build({cfg:{active:false}}); const r=await call(h); strictEqual(r.status,400); });
Deno.test("appointment not found 404", async () => { const h=build({appt:null, cfg:{active:true, environment:"sandbox", asaas_api_key_encrypted:VALID_ENC}}); const r=await call(h); strictEqual(r.status,404); });
Deno.test("existing charge 200", async () => { const h=build({existing:{id:"ex",pix_qr_code:"q",pix_copy_paste:"p",expires_at:"e"}}); const r=await call(h); strictEqual(r.status,200); });
Deno.test("success 200", async () => {
  const orig=globalThis.fetch;
  globalThis.fetch = async (url: any, init?: any) => {
    const u=String(url);
    if (u.includes("/customers?externalReference=")) return new Response(JSON.stringify({data:[]}),{status:200}) as any;
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
