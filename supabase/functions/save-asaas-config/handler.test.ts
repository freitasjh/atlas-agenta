import { strictEqual } from "node:assert/strict";
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { createHandler } from "./handler.ts";
Deno.env.set("ASAAS_MASTER_KEY","segredo");

const TOKEN = "jwt-teste";
function makeService(profile: any) {
  const svc: any = {
    auth: { getUser: async () => ({ data: { user: { id: "u1" } }, error: null }) },
    from: (table: string) => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: profile, error: null }) }) }),
      upsert: async () => ({ error: null }),
      insert: async () => ({ error: null }),
    }),
  };
  return svc as SupabaseClient;
}
function build(profile: any = { tenant_id: "t1", role: "admin" }, throws = false) {
  const svc = makeService(profile);
  return createHandler({ createService: () => { if (throws) throw new Error("cfg"); return svc; } });
}
function call(handler: any, init: any = {}) {
  return handler(new Request("http://localhost/functions/v1/save-asaas-config", {
    method: init.method ?? "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${init.token ?? TOKEN}` },
    body: (init.method ?? "POST") === "GET" ? undefined : JSON.stringify(init.body ?? { apiKey: "key", environment: "sandbox" }),
  }));
}

Deno.test("OPTIONS", async () => {
  let c=0; const h=createHandler({createService:()=>{c++;return makeService({tenant_id:"t1",role:"admin"});}});
  const r=await (h as any)(new Request("http://x",{method:"OPTIONS"}));
  strictEqual(r.status,200); strictEqual(c,0);
});
Deno.test("GET 405", async () => { const h=build(); const r=await call(h,{method:"GET"}); strictEqual(r.status,405); });
Deno.test("throws 500", async () => { const h=build(undefined,true); const r=await call(h); strictEqual(r.status,500); });
Deno.test("no token 401", async () => {
  const h=build();
  const r=await (h as any)(new Request("http://x",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({apiKey:"k",environment:"sandbox"})}));
  strictEqual(r.status,401);
});
Deno.test("invalid body 400", async () => { const h=build(); const r=await call(h,{body:{}}); strictEqual(r.status,400); });
Deno.test("non admin 401", async () => { const h=build({tenant_id:"t1",role:"professional"}); const r=await call(h); strictEqual(r.status,401); });
Deno.test("success 200", async () => {
  const orig=globalThis.fetch;
  globalThis.fetch=async()=>new Response(JSON.stringify({id:"acc"}),{status:200}) as any;
  try {
    const h=build();
    const r=await call(h);
    strictEqual(r.status,200);
    const b=await r.json();
    strictEqual(b.ok,true);
  } finally { globalThis.fetch=orig; }
});
