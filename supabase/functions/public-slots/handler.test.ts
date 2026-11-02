import { deepStrictEqual, strictEqual } from "node:assert/strict";
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { createPublicSlotsHandler } from "./handler.ts";

const TOKEN = "11111111-2222-4333-8444-555555555555";

function fakeService() {
  const service = {
    from: (table: string) => ({
      select: (_cols: string) => ({
        eq: (_col: string, _val: unknown) => ({
          single: async () => {
            if (table === "public_booking_links") {
              return { data: { tenant_id: "t-1", active: true }, error: null };
            }
            return { data: null, error: null };
          },
          eq: (_c2: string, _v2: unknown) => ({
            single: async () => ({ data: null, error: null }),
          }),
        }),
      }),
    }),
    rpc: async (_name: string, _args: unknown) => ({ data: [], error: null }),
  };
  // simpler: override from for services/professionals lists
  (service as any).from = (table: string) => {
    if (table === "public_booking_links") {
      return {
        select: () => ({
          eq: () => ({
            single: async () => ({ data: { tenant_id: "t-1", active: true }, error: null }),
          }),
        }),
      } as unknown;
    }
    if (table === "services" || table === "professionals") {
      return {
        select: () => ({
          eq: () => ({
            eq: async () => ({ data: [], error: null }),
          }),
        }),
      } as unknown;
    }
    if (table === "tenants") {
      return { select: () => ({ eq: () => ({ single: async () => ({ data: { trade_name: "Clínica Teste", legal_name: "Clínica Teste LTDA", phone: "(11) 99999-9999" }, error: null }) }) }) } as unknown;
    }
    return { select: () => ({ eq: async () => ({ data: [], error: null }) }) } as unknown;
  };
  service.rpc = async () => ({ data: [], error: null });
  return service as unknown as SupabaseClient;
}

function build() {
  const service = fakeService();
  const handler = createPublicSlotsHandler({ createService: () => service });
  return { handler };
}

Deno.test("método não-GET -> 405", async () => {
  const { handler } = build();
  const res = await handler(new Request("http://localhost/functions/v1/public-slots?token=" + TOKEN + "&service_id=" + TOKEN + "&date=2026-11-01", { method: "POST" }));
  strictEqual(res.status, 405);
});

Deno.test("params ausentes -> 400", async () => {
  const { handler } = build();
  const res = await handler(new Request("http://localhost/functions/v1/public-slots", { method: "GET" }));
  strictEqual(res.status, 400);
});

Deno.test("link inválido -> 404", async () => {
  const svc = fakeService();
  // override link to null
  (svc as unknown as { from: (t: string) => unknown }).from = (table: string) => {
    if (table === "public_booking_links") {
      return { select: () => ({ eq: () => ({ single: async () => ({ data: null, error: null }) }) }) };
    }
    if (table === "tenants") {
      return { select: () => ({ eq: () => ({ single: async () => ({ data: null, error: null }) }) }) };
    }
    return { select: () => ({ eq: () => ({ eq: async () => ({ data: [], error: null }) }) }) };
  };
  const handler = createPublicSlotsHandler({ createService: () => svc });
  const res = await handler(new Request("http://localhost/functions/v1/public-slots?token=" + TOKEN + "&service_id=" + TOKEN + "&date=2026-11-01", { method: "GET" }));
  strictEqual(res.status, 404);
});

Deno.test("sucesso -> 200", async () => {
  const { handler } = build();
  const res = await handler(new Request("http://localhost/functions/v1/public-slots?token=" + TOKEN + "&service_id=" + TOKEN + "&date=2026-11-01", { method: "GET" }));
  strictEqual(res.status, 200);
  const body = await res.json();
  strictEqual(Array.isArray(body.slots), true);
});