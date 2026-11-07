import { strictEqual } from "node:assert/strict";
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { createHandler } from "./handler.ts";

Deno.env.set("ASAAS_WEBHOOK_TOKEN","segredo-token");

const TOKEN = "segredo-token";
function baseService(overrides: any = {}) {
  overrides.events ??= [];
  overrides.finished ??= [];
  const svc: any = {
    auth: { getUser: async () => ({ data: { user: null }, error: null }) },
    from: (table: string) => {
      if (table === "subscription_charges") return {
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: overrides.charge ?? { id: "sc1", tenant_id: "t1", status: "pendente" }, error: null }) }) }),
        update: () => ({ eq: async () => ({ error: overrides.updErr ?? null }) }),
      };
      if (table === "tenants") return { update: () => ({ eq: async () => ({ error: overrides.tErr ?? null }) }) };
      if (table === "webhook_events") {
        let pairRead = false;
        return {
          select: () => {
            const builder: any = {
              eq(column: string) {
                if (column === "payment_id") pairRead = true;
                return builder;
              },
              maybeSingle: async () => ({
                data: pairRead ? (overrides.existing ?? null) : (overrides.existingByEvent ?? null),
                error: null,
              }),
            };
            return builder;
          },
          insert: async (row: Record<string, unknown>) => {
            overrides.events.push(row);
            return { error: overrides.insEvErr ?? null };
          },
          update: (values: Record<string, unknown>) => {
            overrides.finished.push(values);
            const builder: any = {
              eq() { return builder; },
              then(resolve: any, reject: any) {
                return Promise.resolve({ error: overrides.finishErr ?? null }).then(resolve, reject);
              },
            };
            return builder;
          },
        };
      }
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
  const headers: Record<string,string> = { "Content-Type": "application/json" };
  if (init.token !== null) headers["asaas-access-token"] = init.token ?? TOKEN;
  return handler(new Request("http://localhost/functions/v1/asaas-subscription-webhook", {
    method: init.method ?? "POST",
    headers,
    body: (init.method ?? "POST") === "GET" ? undefined : JSON.stringify(init.body ?? { id: "evt1", event: "PAYMENT_RECEIVED", payment: { id: "pay1" } }),
  }));
}

Deno.test("OPTIONS", async () => {
  let c=0; const h=createHandler({createService:()=>{c++;return baseService();}});
  const r=await (h as any)(new Request("http://x",{method:"OPTIONS"}));
  strictEqual(r.status,200); strictEqual(c,0);
});
Deno.test("GET 405", async () => { const h=build(); const r=await call(h,{method:"GET"}); strictEqual(r.status,405); });
Deno.test("throws 500", async () => { const h=build({},true); const r=await call(h); strictEqual(r.status,500); });
Deno.test("no token 401", async () => { const h=build(); const r=await call(h,{token:null}); strictEqual(r.status,401); });
Deno.test("invalid token 401", async () => { const h=build(); const r=await call(h,{token:"wrong"}); strictEqual(r.status,401); });
Deno.test("invalid body 400", async () => { const h=build(); const r=await call(h,{body:{}}); strictEqual(r.status,400); });
Deno.test("unknown payment 200", async () => { const h=build({charge:null}); const r=await call(h); strictEqual(r.status,200); });
Deno.test("duplicate event 200", async () => { const h=build({insEvErr:{code:"23505"}, existing:{processed_at:"2026-11-06T10:00:00.000Z"}}); const r=await call(h); strictEqual(r.status,200); });
Deno.test("success 200", async () => { const h=build(); const r=await call(h); strictEqual(r.status,200); });

Deno.test("grava source='asaas' e só marca processed_at depois do efeito", async () => {
  const state: any = {};
  const h = build(state);
  const r = await call(h);
  strictEqual(r.status, 200);
  strictEqual(state.events.length, 1);
  strictEqual(state.events[0].source, "asaas");
  strictEqual(state.events[0].processed_at, null);
  strictEqual(state.finished.length, 1);
  strictEqual(typeof state.finished[0].processed_at, "string");
  strictEqual(state.finished[0].status, "processado");
});

Deno.test("evento pendente de entrega anterior é retomado (takeover)", async () => {
  const state: any = { charge: { id: "sc1", tenant_id: "t1", status: "pendente" }, insEvErr: { code: "23505" }, existing: { processed_at: null } };
  const h = build(state);
  const r = await call(h);
  strictEqual(r.status, 200);
  strictEqual(state.finished.length, 1);
});
