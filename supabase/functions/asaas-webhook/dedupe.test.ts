import { deepStrictEqual, strictEqual } from "node:assert/strict";
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { beginEvent, finishEvent } from "./dedupe.ts";

interface FakeState {
  inserted: Record<string, unknown>[];
  insertError: { code?: string; message?: string } | null;
  existing: { processed_at: string | null } | null;
  existingByEvent?: { processed_at: string | null } | null;
  readFilters: Array<[string, unknown]>;
  updateValues: Record<string, unknown> | null;
  updateFilters: Array<[string, unknown]>;
  updateError: { code?: string; message?: string } | null;
}

function fake(state: FakeState): SupabaseClient {
  const from = (table: string) => {
    if (table !== "webhook_events") throw new Error(`tabela inesperada: ${table}`);
    return {
      insert: async (row: Record<string, unknown>) => {
        state.inserted.push(row);
        return { error: state.insertError };
      },
      select: () => {
        let pairRead = false;
        const builder: any = {
          eq(column: string, value: unknown) {
            state.readFilters.push([column, value]);
            if (column === "payment_id") pairRead = true;
            return builder;
          },
          maybeSingle: async () => ({
            data: pairRead ? state.existing : (state.existingByEvent ?? null),
            error: null,
          }),
        };
        return builder;
      },
      update: (values: Record<string, unknown>) => {
        state.updateValues = values;
        const builder: any = {
          eq(column: string, value: unknown) {
            state.updateFilters.push([column, value]);
            return builder;
          },
          then(resolve: any, reject: any) {
            return Promise.resolve({ error: state.updateError }).then(resolve, reject);
          },
        };
        return builder;
      },
    };
  };
  return { from } as unknown as SupabaseClient;
}

function baseState(overrides: Partial<FakeState> = {}): FakeState {
  return {
    inserted: [],
    insertError: null,
    existing: null,
    readFilters: [],
    updateValues: null,
    updateFilters: [],
    updateError: null,
    ...overrides,
  };
}

const key = { tenantId: "t1", eventId: "evt1", paymentId: "pay1", eventType: "PAYMENT_RECEIVED" };

Deno.test("insere evento com processed_at nulo e payload vazio", async () => {
  const state = baseState();
  strictEqual(await beginEvent(fake(state), key), "process");
  strictEqual(state.inserted.length, 1);
  deepStrictEqual(state.inserted[0], {
    event_id: "evt1",
    payment_id: "pay1",
    event_type: "PAYMENT_RECEIVED",
    tenant_id: "t1",
    source: "asaas",
    external_event_id: "evt1",
    instance_name: "asaas",
    status: "recebido",
    processed_at: null,
    payload: {},
  });
});

Deno.test("23505 com processed_at não nulo é duplicata sem update", async () => {
  const state = baseState({
    insertError: { code: "23505", message: "duplicate key" },
    existing: { processed_at: "2026-11-06T10:00:00.000Z" },
  });
  strictEqual(await beginEvent(fake(state), key), "already_processed");
  deepStrictEqual(state.readFilters, [
    ["event_id", "evt1"],
    ["payment_id", "pay1"],
  ]);
  strictEqual(state.updateValues, null);
});

Deno.test("23505 com processed_at nulo é takeover", async () => {
  const state = baseState({
    insertError: { code: "23505", message: "duplicate key" },
    existing: { processed_at: null },
  });
  strictEqual(await beginEvent(fake(state), key), "process");
});

Deno.test("23505 sem o par mas com o mesmo event_id é duplicata (índice legado)", async () => {
  const state = baseState({
    insertError: { code: "23505", message: "duplicate key" },
    existing: null,
    existingByEvent: { processed_at: null },
  });
  strictEqual(await beginEvent(fake(state), key), "already_processed");
  deepStrictEqual(state.readFilters, [
    ["event_id", "evt1"],
    ["payment_id", "pay1"],
    ["event_id", "evt1"],
  ]);
});

Deno.test("23505 sem nenhuma linha correspondente é takeover (conflito transitório)", async () => {
  const state = baseState({
    insertError: { code: "23505", message: "duplicate key" },
    existing: null,
    existingByEvent: null,
  });
  strictEqual(await beginEvent(fake(state), key), "process");
});

Deno.test("erro diferente de 23505 é propagado", async () => {
  const state = baseState({ insertError: { code: "08006", message: "connection failure" } });
  let thrown: unknown;
  try {
    await beginEvent(fake(state), key);
  } catch (error) {
    thrown = error;
  }
  strictEqual((thrown as { code?: string }).code, "08006");
});

Deno.test("finishEvent filtra por event_id e payment_id", async () => {
  const state = baseState();
  await finishEvent(fake(state), "evt1", "pay1");
  deepStrictEqual(state.updateFilters, [
    ["event_id", "evt1"],
    ["payment_id", "pay1"],
  ]);
  strictEqual(state.updateValues?.status, "processado");
  strictEqual(typeof state.updateValues?.processed_at, "string");
});
