import { deepStrictEqual, strictEqual } from "node:assert/strict";
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { createPublicBookHandler } from "./handler.ts";

const TOKEN = "11111111-2222-4333-8444-555555555555";
const FUTURE = new Date(Date.now() + 86400000).toISOString();

function fakeService(opts: { linkActive?: boolean; service?: unknown; professional?: unknown; serviceProfessional?: unknown; slots?: unknown[]; conflicts?: unknown[]; appointmentError?: { code?: string } | null } = {}) {
  const linkActive = opts.linkActive ?? true;
  const serviceRow = opts.service === undefined ? { id: TOKEN, tenant_id: "t-1", duration_minutes: 30, price_cents: 1000, active: true } : opts.service;
  const professional = opts.professional === undefined ? { id: TOKEN } : opts.professional;
  const serviceProfessional = opts.serviceProfessional === undefined ? { professional_id: TOKEN } : opts.serviceProfessional;
  const slots = opts.slots ?? [{ slot_start: FUTURE }];
  const conflicts = opts.conflicts ?? [];
  const appointmentError = opts.appointmentError ?? null;

  const service = {
    from: (table: string) => {
      if (table === "public_booking_links") {
        return { select: () => ({ eq: () => ({ single: async () => ({ data: linkActive ? { tenant_id: "t-1", active: true } : null, error: null }) }) }) };
      }
      if (table === "tenants") {
        return { select: () => ({ eq: () => ({ single: async () => ({ data: { timezone: "America/Sao_Paulo" }, error: null }) }) }) };
      }
      if (table === "services") {
        return { select: () => ({ eq: () => ({ eq: () => ({ single: async () => ({ data: serviceRow, error: null }) }) }) }) };
      }
      if (table === "professionals") {
        return { select: () => ({ eq: () => ({ eq: () => ({ eq: () => ({ single: async () => ({ data: professional, error: null }) }) }) }) }) };
      }
      if (table === "service_professionals") {
        return { select: () => ({ eq: () => ({ eq: () => ({ eq: () => ({ single: async () => ({ data: serviceProfessional, error: null }) }) }) }) }) };
      }
      if (table === "appointments") {
        return {
          select: () => ({ eq: () => ({ eq: () => ({ neq: () => ({ lt: () => ({ gt: async () => ({ data: conflicts, error: null }) }) }) }) }) }),
          insert: () => ({ select: () => ({ single: async () => (appointmentError ? { data: null, error: appointmentError } : { data: { id: "appt-1", status: "pendente" }, error: null }) }) }),
        };
      }
      if (table === "customers") {
        return {
          select: () => ({ eq: () => ({ eq: () => ({ single: async () => ({ data: { id: "cust-1" }, error: null }) }) }) }),
          insert: () => ({ select: () => ({ single: async () => ({ data: { id: "cust-new" }, error: null }) }) }),
        };
      }
      if (table === "audit_log") {
        return { insert: async () => ({ error: null }) };
      }
      return { select: () => ({ eq: async () => ({ data: null, error: null }) }), insert: async () => ({ error: null }) };
    },
    rpc: async () => ({ data: slots, error: null }),
  };
  return service as unknown as SupabaseClient;
}

function build(opts?: Parameters<typeof fakeService>[0], overrides: { createServiceThrows?: boolean } = {}) {
  const svc = fakeService(opts);
  const handler = createPublicBookHandler({ createService: () => { if (overrides.createServiceThrows) throw new Error("config"); return svc; } });
  return { handler };
}

async function call(handler: (r: Request) => Promise<Response>, body: unknown) {
  return handler(new Request("http://localhost/functions/v1/public-book", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }));
}

const VALID_BODY = {
  token: TOKEN,
  service_id: TOKEN,
  professional_id: TOKEN,
  starts_at: FUTURE,
  customer_name: "Joao",
  customer_phone: "11999999999",
};

Deno.test("método não-POST -> 405", async () => {
  const { handler } = build();
  const res = await handler(new Request("http://localhost/functions/v1/public-book", { method: "GET" }));
  strictEqual(res.status, 405);
});

Deno.test("corpo inválido -> 400", async () => {
  const { handler } = build();
  const res = await call(handler, { token: "short" });
  strictEqual(res.status, 400);
});

Deno.test("link inválido -> 404", async () => {
  const { handler } = build({ linkActive: false });
  const res = await call(handler, VALID_BODY);
  strictEqual(res.status, 404);
});

Deno.test("serviço inválido -> 400", async () => {
  const { handler } = build({ service: null });
  const res = await call(handler, VALID_BODY);
  strictEqual(res.status, 400);
  strictEqual((await res.json()).error, "invalid_service");
});

Deno.test("profissional inválido -> 400", async () => {
  const { handler } = build({ professional: null });
  const res = await call(handler, VALID_BODY);
  strictEqual(res.status, 400);
  strictEqual((await res.json()).error, "invalid_professional");
});

Deno.test("slot não disponível -> 409", async () => {
  const { handler } = build({ slots: [] });
  const res = await call(handler, VALID_BODY);
  strictEqual(res.status, 409);
  strictEqual((await res.json()).error, "slot_unavailable");
});

Deno.test("conflito 23P01 -> 409", async () => {
  const { handler } = build({ appointmentError: { code: "23P01" } });
  const res = await call(handler, VALID_BODY);
  strictEqual(res.status, 409);
  strictEqual((await res.json()).error, "slot_unavailable");
});

Deno.test("createService lança -> 500", async () => {
  const { handler } = build({}, { createServiceThrows: true });
  const res = await call(handler, VALID_BODY);
  strictEqual(res.status, 500);
});

Deno.test("sucesso -> 201", async () => {
  const { handler } = build();
  const res = await call(handler, VALID_BODY);
  strictEqual(res.status, 201);
  const body = await res.json();
  strictEqual(body.success, true);
});