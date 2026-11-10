import { describe, expect, it } from "vitest";

import { loadSettlement } from "../../supabase/functions/_shared/payments.ts";

/**
 * Regressão do bug pdv-checkout-anonimo (portado do Deno órfão).
 *
 * `loadSettlement` consulta `customers`/`services` por id opcional: `customer_id`
 * é NULL em walk-in anônimo e `service_id` é NULL em venda por combo. Montar
 * `.eq("id", null)` vira `id=eq.null` no PostgREST (400 22P02 → 500 INTERNAL).
 * A guarda `queryOptionalById` só pode emitir o filtro `id` quando o uuid existe.
 *
 * O fake registra TODOS os filtros `.eq` por tabela; a asserção olha apenas a
 * coluna `id` (a query também filtra `tenant_id`, por isso a contagem ingênua
 * por tabela enganava).
 */

const TENANT = "22222222-2222-4222-8222-222222222222";
const APPOINTMENT = "11111111-1111-4111-8111-111111111111";
const PROFESSIONAL = "44444444-4444-4444-8444-444444444444";
const CUSTOMER = "55555555-5555-4555-8555-555555555555";
const SERVICE = "66666666-6666-4666-8666-666666666666";

const identity = { userId: "u1", tenantId: TENANT, role: "admin" };

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
    let settled = false;
    const settle = () => {
      if (!settled) {
        settled = true;
        filters.push(...local);
      }
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
      // `.order()` devolve o builder thenable do supabase-js; Promise.all aguarda.
      then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
        Promise.resolve(settle()).then(resolve, reject),
    };
    return chain;
  }

  const service = {
    from: (table: string) => builder(table),
    rpc: async () => ({ data: summary, error: null }),
  };

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

function idFilters(filters: Filter[], table: string): Filter[] {
  return filters.filter((filter) => filter.table === table && filter.column === "id");
}

async function settlementFor(appointment: Record<string, unknown>) {
  const { service, filters } = fakeService(appointment);
  const settlement = (await loadSettlement(service as never, identity, APPOINTMENT)) as {
    appointment: Record<string, unknown>;
  };
  return { settlement, filters };
}

describe("loadSettlement — id opcional (customer/service)", () => {
  it("walk-in anônimo (ambos null): nenhum filtro `id` é emitido e nomes ficam null", async () => {
    const { settlement, filters } = await settlementFor(
      appointmentRow({ customer_id: null, service_id: null }),
    );

    expect(idFilters(filters, "customers")).toHaveLength(0);
    expect(idFilters(filters, "services")).toHaveLength(0);
    expect(filters.some((filter) => filter.value === null)).toBe(false);

    expect(settlement.appointment.customer_name).toBeNull();
    expect(settlement.appointment.service_name).toBeNull();
    expect(settlement.appointment.professional_name).toBe("Beto");
  });

  it("cliente null e serviço presente: só o filtro `id` de services com o uuid", async () => {
    const { settlement, filters } = await settlementFor(
      appointmentRow({ customer_id: null, service_id: SERVICE }),
    );

    expect(idFilters(filters, "customers")).toHaveLength(0);

    const serviceIdFilters = idFilters(filters, "services");
    expect(serviceIdFilters).toHaveLength(1);
    expect(serviceIdFilters[0]?.value).toBe(SERVICE);

    expect(settlement.appointment.customer_name).toBeNull();
    expect(settlement.appointment.service_name).toBe("Corte");
  });

  it("cliente presente e serviço null (combo): só o filtro `id` de customers com o uuid", async () => {
    const { settlement, filters } = await settlementFor(
      appointmentRow({ customer_id: CUSTOMER, service_id: null }),
    );

    const customerIdFilters = idFilters(filters, "customers");
    expect(customerIdFilters).toHaveLength(1);
    expect(customerIdFilters[0]?.value).toBe(CUSTOMER);

    expect(idFilters(filters, "services")).toHaveLength(0);

    expect(settlement.appointment.customer_name).toBe("Cliente");
    expect(settlement.appointment.service_name).toBeNull();
  });

  it("agendado normal (ambos presentes): um filtro `id` por tabela, com o uuid correto", async () => {
    const { settlement, filters } = await settlementFor(
      appointmentRow({ customer_id: CUSTOMER, service_id: SERVICE }),
    );

    const customerIdFilters = idFilters(filters, "customers");
    const serviceIdFilters = idFilters(filters, "services");
    expect(customerIdFilters).toHaveLength(1);
    expect(customerIdFilters[0]?.value).toBe(CUSTOMER);
    expect(serviceIdFilters).toHaveLength(1);
    expect(serviceIdFilters[0]?.value).toBe(SERVICE);

    expect(settlement.appointment.customer_name).toBe("Cliente");
    expect(settlement.appointment.service_name).toBe("Corte");
  });
});
