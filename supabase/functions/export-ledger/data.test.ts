// Camada de dados do export (ADR-10): paginação acima do cap do PostgREST.
//
// O `select` único era o defeito do review: `max_rows = 1000` corta a resposta
// sem erro, então um tenant com >1000 linhas receberia arquivo truncado e o log
// gravaria sucesso. Estes testes provam que a leitura pagina até o fim e que o
// `.in()` derivado das linhas vai em blocos (URL do gateway).
import { deepStrictEqual, strictEqual } from "node:assert/strict";
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { loadPayload } from "./data.ts";

type Row = Record<string, unknown>;

interface InCall {
  table: string;
  column: string;
  size: number;
}

interface FakeState {
  tables: Record<string, Row[]>;
  inCalls: InCall[];
  orCalls: Array<{ table: string; expression: string }>;
}

function fakeBuilder(state: FakeState, table: string) {
  const filters: Array<{ op: "gte" | "lt" | "lte"; column: string; value: string }> = [];
  let rangeFrom = 0;
  let rangeTo = Number.MAX_SAFE_INTEGER;

  const rows = (): Row[] => {
    const base = state.tables[table] ?? [];
    return base.filter((row) =>
      filters.every((filter) => {
        const raw = row[filter.column];
        if (typeof raw !== "string") return true;
        if (filter.op === "gte") return raw >= filter.value;
        if (filter.op === "lte") return raw <= filter.value;
        return raw < filter.value;
      }),
    );
  };

  // deno-lint-ignore no-explicit-any
  const node: any = {
    select: () => node,
    eq: () => node,
    is: () => node,
    not: () => node,
    gte: (column: string, value: string) => {
      filters.push({ op: "gte", column, value });
      return node;
    },
    lt: (column: string, value: string) => {
      filters.push({ op: "lt", column, value });
      return node;
    },
    lte: (column: string, value: string) => {
      filters.push({ op: "lte", column, value });
      return node;
    },
    in: (column: string, values: readonly string[]) => {
      state.inCalls.push({ table, column, size: values.length });
      return node;
    },
    or: (expression: string) => {
      state.orCalls.push({ table, expression });
      return node;
    },
    order: () => node,
    range: (from: number, to: number) => {
      rangeFrom = from;
      rangeTo = to;
      return node;
    },
    then: (resolve: (value: unknown) => unknown) =>
      Promise.resolve({ data: rows().slice(rangeFrom, rangeTo + 1), error: null }).then(resolve),
  };
  return node;
}

function fakeService(state: FakeState): SupabaseClient {
  return {
    from: (table: string) => fakeBuilder(state, table),
  } as unknown as SupabaseClient;
}

function stateWith(tables: Record<string, Row[]>): FakeState {
  return { tables, inCalls: [], orCalls: [] };
}

const INI = "2026-01-01T03:00:00.000Z";
const FIM = "2026-02-01T03:00:00.000Z";

function input(over: Partial<Parameters<typeof loadPayload>[1]> = {}) {
  return {
    tenantId: "t1",
    ini: INI,
    fim: FIM,
    periodoIni: "2026-01-01",
    periodoFim: "2026-01-31",
    formato: "csv" as const,
    escopo: "receber" as const,
    timeZone: "America/Sao_Paulo",
    ...over,
  };
}

Deno.test("ledger >1000 linhas: pagina tudo e faz .in() em blocos", async () => {
  const total = 2_501;
  const payments: Row[] = Array.from({ length: total }, (_, index) => ({
    id: `p${String(index).padStart(4, "0")}`,
    appointment_id: `a${index % 400}`,
    amount_cents: 1_000,
    tip_cents: 0,
    method: "pix_sistema",
    received_at: "2026-01-15T12:00:00.000Z",
  }));
  const appointments: Row[] = Array.from({ length: 400 }, (_, index) => ({
    id: `a${index}`,
    customer_id: `c${index}`,
  }));
  const customers: Row[] = Array.from({ length: 400 }, (_, index) => ({
    id: `c${index}`,
    name: `Cliente ${index}`,
  }));

  const state = stateWith({
    appointment_payments: payments,
    appointments,
    customers,
  });

  const payload = await loadPayload(fakeService(state), input());
  strictEqual(payload.movimentos.length, total);

  const appointmentCalls = state.inCalls.filter((call) => call.table === "appointments");
  strictEqual(appointmentCalls.length, 3);
  for (const call of state.inCalls) strictEqual(call.size <= 150, true);
});

Deno.test("fiscal: recorte do período vai para o banco e pagina >1000", async () => {
  const total = 1_500;
  const docs: Row[] = Array.from({ length: total }, (_, index) => ({
    id: `f${String(index).padStart(4, "0")}`,
    numero: String(index),
    serie: "1",
    chave_acesso: null,
    status: "autorizada",
    valor_cents: 1_000,
    created_at: "2026-01-10T12:00:00.000Z",
    authorized_at: "2026-01-10T13:00:00.000Z",
  }));

  const state = stateWith({ fiscal_documents: docs });
  const payload = await loadPayload(fakeService(state), input({ escopo: "fiscal" }));

  strictEqual(payload.fiscal.length, total);
  const orCall = state.orCalls.find((call) => call.table === "fiscal_documents");
  strictEqual(orCall !== undefined, true);
  strictEqual(orCall?.expression.includes(`authorized_at.gte.${INI}`), true);
  strictEqual(orCall?.expression.includes(`created_at.gte.${INI}`), true);
  strictEqual(orCall?.expression.includes(`authorized_at.is.null`), true);
});

Deno.test("fiscal: referência é authorized_at ?? created_at", async () => {
  const state = stateWith({
    fiscal_documents: [
      {
        id: "f1",
        numero: "1",
        serie: "1",
        chave_acesso: null,
        status: "autorizada",
        valor_cents: 1_000,
        created_at: "2026-01-10T12:00:00.000Z",
        authorized_at: "2025-12-01T12:00:00.000Z",
      },
      {
        id: "f2",
        numero: "2",
        serie: "1",
        chave_acesso: null,
        status: "autorizada",
        valor_cents: 2_000,
        created_at: "2026-01-10T12:00:00.000Z",
        authorized_at: null,
      },
    ],
  });

  const payload = await loadPayload(fakeService(state), input({ escopo: "fiscal" }));
  deepStrictEqual(
    payload.fiscal.map((doc) => doc.id),
    ["f2"],
  );
});
