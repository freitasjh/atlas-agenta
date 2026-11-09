// Unit de `loadSettlement` (bug pdv-checkout-anonimo): ids opcionais
// (`customer_id` em walk-in anônimo, `service_id` em venda por combo) nunca
// podem virar filtro `.eq("id", null)` — o PostgREST responde 400 22P02 e o
// chamador converte em 500 INTERNAL.
import { deepStrictEqual, strictEqual } from "node:assert/strict";
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import type { Identity } from "./identity.ts";
import { loadSettlement } from "./payments.ts";

const TENANT = "22222222-2222-4222-8222-222222222222";
const APPOINTMENT = "11111111-1111-4111-8111-111111111111";
const PROFESSIONAL = "44444444-4444-4444-8444-444444444444";
const CUSTOMER = "55555555-5555-4555-8555-555555555555";

const identity: Identity = { userId: "u1", tenantId: TENANT, role: "admin" };

interface Filter {
  table: string;
  column: string;
  value: unknown;
}

function fakeService(appointment: Record<string, unknown>) {
  const filters: Filter[] = [];
  const summary = {
    price_cents: 10_000,
    total_paid_cents: 0,
    tip_cents: 0,
    reserved_cents: 0,
    remaining_cents: 10_000,
    payment_status: "sem_pagamento",
    pending_charge_id: null,
    pending_charge_amount_cents: 0,
  };

  function rowsFor(table: string): { data: unknown; error: unknown } {
    switch (table) {
      case "appointments":
        return { data: appointment, error: null };
      case "customers":
        return { data: { name: "Cliente" }, error: null };
      case "services":
        return { data: { name: "Corte" }, error: null };
      case "professionals":
        return { data: { name: "Beto" }, error: null };
      case "appointment_payments":
      case "charges":
        return { data: [], error: null };
      default:
        return { data: null, error: null };
    }
  }

  function builder(table: string): any {
    const local: Filter[] = [];
    const settle = () => {
      filters.push(...local);
      return rowsFor(table);
    };
    const chain: any = {
      select: () => chain,
      eq: (column: string, value: unknown) => {
        local.push({ table, column, value });
        return chain;
      },
      order: () => chain,
      maybeSingle: async () => settle(),
      // `.order()` devolve o builder thenable do supabase-js; o Promise.all
      // aguarda esse objeto.
      then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
        Promise.resolve(settle()).then(resolve, reject),
    };
    return chain;
  }

  const service = {
    from: (table: string) => builder(table),
    rpc: async () => ({ data: summary, error: null }),
  } as unknown as SupabaseClient;

  return { service, filters };
}

function appointmentRow(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    id: APPOINTMENT,
    status: "em_atendimento",
    origin: "walk_in",
    starts_at: "2026-11-09T15:00:00.000Z",
    price_cents: 10_000,
    customer_id: null,
    service_id: null,
    professional_id: PROFESSIONAL,
    ...overrides,
  };
}

Deno.test("loadSettlement: walk-in anônimo não consulta customer/service com id null", async () => {
  const { service, filters } = fakeService(
    appointmentRow({ customer_id: null, service_id: null }),
  );

  const settlement = (await loadSettlement(service, identity, APPOINTMENT)) as {
    appointment: Record<string, unknown>;
  };

  deepStrictEqual(
    filters.filter((filter) => filter.value === null),
    [],
    "nenhum filtro pode ser montado com valor null",
  );
  strictEqual(settlement.appointment.customer_name, null);
  strictEqual(settlement.appointment.service_name, null);
  strictEqual(settlement.appointment.professional_name, "Beto");
});

Deno.test("loadSettlement: cliente presente consulta customer; service null (combo) é pulado", async () => {
  const { service, filters } = fakeService(
    appointmentRow({ customer_id: CUSTOMER, service_id: null }),
  );

  const settlement = (await loadSettlement(service, identity, APPOINTMENT)) as {
    appointment: Record<string, unknown>;
  };

  const customerFilters = filters.filter((filter) => filter.table === "customers");
  const serviceFilters = filters.filter((filter) => filter.table === "services");
  strictEqual(customerFilters.length, 1);
  strictEqual(customerFilters[0]?.column, "id");
  strictEqual(customerFilters[0]?.value, CUSTOMER);
  deepStrictEqual(serviceFilters, []);
  strictEqual(settlement.appointment.customer_name, "Cliente");
  strictEqual(settlement.appointment.service_name, null);
});
