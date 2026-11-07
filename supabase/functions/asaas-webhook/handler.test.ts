import { deepStrictEqual, strictEqual } from "node:assert/strict";
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { createHandler } from "./handler.ts";

const GLOBAL_TOKEN = "global-token";
const TENANT_TOKEN = "tenant-token";
Deno.env.set("ASAAS_WEBHOOK_TOKEN", GLOBAL_TOKEN);

interface Charge {
  id: string;
  tenant_id: string;
  status: string;
  amount_cents: number;
  appointment_id: string | null;
}

interface FakeOptions {
  charge?: Charge | null;
  chargeError?: { code?: string; message?: string } | null;
  tenantToken?: string | null;
  tenantError?: { code?: string; message?: string } | null;
  existing?: { processed_at: string | null } | null;
  insertError?: { code?: string; message?: string } | null;
  finishError?: { code?: string; message?: string } | null;
  rpcData?: unknown;
  rpcError?: { code?: string; message?: string } | null;
  transitionUpdated?: boolean;
  auditError?: { code?: string; message?: string } | null;
  existingAudit?: { id: string } | null;
  existingAudits?: Array<{ id: string }>;
}

interface Calls {
  lookups: number;
  inserts: Record<string, unknown>[];
  chargeUpdates: Array<{ values: Record<string, unknown>; filters: Array<[string, unknown]> }>;
  finishUpdates: Array<{ values: Record<string, unknown>; filters: Array<[string, unknown]> }>;
  rpc: Array<{ name: string; args: Record<string, unknown> }>;
  audits: Record<string, unknown>[];
  auditReads: number;
  sequence: string[];
}

interface Harness {
  handler: ReturnType<typeof createHandler>;
  calls: Calls;
  options: FakeOptions;
}

const DEFAULT_CHARGE: Charge = {
  id: "ch1",
  tenant_id: "t1",
  status: "pendente",
  amount_cents: 10_000,
  appointment_id: "a1",
};

function build(options: FakeOptions = {}, throws = false): Harness {
  const calls: Calls = {
    lookups: 0,
    inserts: [],
    chargeUpdates: [],
    finishUpdates: [],
    rpc: [],
    audits: [],
    auditReads: 0,
    sequence: [],
  };
  const state = { options };

  const from = (table: string) => {
    if (table === "charges") {
      return {
        select: () => {
          const builder: any = {
            eq() {
              return builder;
            },
            maybeSingle: async () => {
              calls.lookups += 1;
              calls.sequence.push("charge_lookup");
              return {
                data:
                  "charge" in state.options ? state.options.charge : DEFAULT_CHARGE,
                error: state.options.chargeError ?? null,
              };
            },
          };
          return builder;
        },
        update: (values: Record<string, unknown>) => {
          const entry = { values, filters: [] as Array<[string, unknown]> };
          calls.chargeUpdates.push(entry);
          calls.sequence.push("charge_update");
          const builder: any = {
            eq(column: string, value: unknown) {
              entry.filters.push([column, value]);
              return builder;
            },
            select: async () => ({
              data: state.options.transitionUpdated === false ? [] : [{ id: DEFAULT_CHARGE.id }],
              error: null,
            }),
            then(resolve: any, reject: any) {
              return Promise.resolve({ data: null, error: null }).then(resolve, reject);
            },
          };
          return builder;
        },
      };
    }

    if (table === "tenant_asaas_config") {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => {
              calls.sequence.push("tenant_config");
              const token =
                "tenantToken" in state.options
                  ? state.options.tenantToken
                  : TENANT_TOKEN;
              return {
                data: token === null ? null : { asaas_webhook_token: token },
                error: state.options.tenantError ?? null,
              };
            },
          }),
        }),
      };
    }

    if (table === "webhook_events") {
      return {
        insert: async (row: Record<string, unknown>) => {
          calls.inserts.push(row);
          calls.sequence.push("event_insert");
          return { error: state.options.insertError ?? null };
        },
        select: () => {
          const builder: any = {
            eq() {
              return builder;
            },
            maybeSingle: async () => ({
              data: state.options.existing ?? null,
              error: null,
            }),
          };
          return builder;
        },
        update: (values: Record<string, unknown>) => {
          const entry = { values, filters: [] as Array<[string, unknown]> };
          calls.finishUpdates.push(entry);
          calls.sequence.push("event_finish");
          const builder: any = {
            eq(column: string, value: unknown) {
              entry.filters.push([column, value]);
              return builder;
            },
            then(resolve: any, reject: any) {
              return Promise.resolve({ error: state.options.finishError ?? null }).then(
                resolve,
                reject,
              );
            },
          };
          return builder;
        },
      };
    }

    if (table === "audit_log") {
      return {
        insert: async (row: Record<string, unknown>) => {
          calls.audits.push(row);
          calls.sequence.push("audit");
          return { error: state.options.auditError ?? null };
        },
        select: () => {
          const builder: any = {
            eq() {
              return builder;
            },
            limit() {
              return builder;
            },
            then(resolve: any, reject: any) {
              calls.auditReads += 1;
              calls.sequence.push("audit_read");
              const rows =
                state.options.existingAudits ??
                (state.options.existingAudit ? [state.options.existingAudit] : []);
              return Promise.resolve({ data: rows, error: null }).then(resolve, reject);
            },
          };
          return builder;
        },
      };
    }

    throw new Error(`tabela inesperada: ${table}`);
  };

  const service = {
    from,
    rpc: async (name: string, args: Record<string, unknown>) => {
      calls.rpc.push({ name, args });
      calls.sequence.push("rpc");
      if (state.options.rpcError) return { data: null, error: state.options.rpcError };
      return {
        data:
          "rpcData" in state.options
            ? state.options.rpcData
            : { ok: true, anomaly: null, replayed: false, charge_status: "pago" },
        error: null,
      };
    },
  } as unknown as SupabaseClient;

  const handler = createHandler({
    createService: () => {
      if (throws) throw new Error("config");
      return service;
    },
  });
  return { handler, calls, options: state.options };
}

function request(
  handler: Harness["handler"],
  init: {
    method?: string;
    token?: string | null;
    body?: unknown;
    rawBody?: string;
  } = {},
): Promise<Response> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (init.token !== null) headers["asaas-access-token"] = init.token ?? TENANT_TOKEN;
  const method = init.method ?? "POST";
  const body =
    method === "GET"
      ? undefined
      : (init.rawBody ??
        JSON.stringify(
          init.body ?? {
            id: "evt1",
            event: "PAYMENT_RECEIVED",
            payment: { id: "pay1", value: 100, paymentDate: "2026-11-06" },
          },
        ));
  return handler(
    new Request("http://localhost/functions/v1/asaas-webhook", { method, headers, body }),
  );
}

function captureLogs(): { lines: string[]; restore: () => void } {
  const original = console.log;
  const lines: string[] = [];
  console.log = (...args: unknown[]) => {
    lines.push(args.map((arg) => String(arg)).join(" "));
  };
  return { lines, restore: () => (console.log = original) };
}

Deno.test("OPTIONS responde 200 sem tocar no service client", async () => {
  let created = 0;
  const handler = createHandler({
    createService: () => {
      created += 1;
      throw new Error("não deveria criar");
    },
  });
  const response = await handler(new Request("http://x", { method: "OPTIONS" }));
  strictEqual(response.status, 200);
  strictEqual(created, 0);
});

Deno.test("método diferente de POST responde 405", async () => {
  const { handler } = build();
  const response = await request(handler, { method: "GET" });
  strictEqual(response.status, 405);
});

Deno.test("falha ao criar o service client responde 500", async () => {
  const { handler } = build({}, true);
  const response = await request(handler);
  strictEqual(response.status, 500);
});

Deno.test("token ausente responde 401 sem lookup", async () => {
  const { handler, calls } = build();
  const response = await request(handler, { token: null });
  strictEqual(response.status, 401);
  strictEqual(calls.lookups, 0);
  strictEqual(calls.inserts.length, 0);
});

Deno.test("JSON inválido responde 400", async () => {
  const { handler, calls } = build();
  const response = await request(handler, { rawBody: "{nao-json" });
  strictEqual(response.status, 400);
  strictEqual(calls.lookups, 0);
});

Deno.test("id ausente responde 400 sem insert", async () => {
  const { handler, calls } = build();
  const response = await request(handler, {
    body: { event: "PAYMENT_RECEIVED", payment: { id: "pay1" } },
  });
  strictEqual(response.status, 400);
  strictEqual(calls.inserts.length, 0);
});

Deno.test("payment ausente responde 200 sem lookup e sem dedupe", async () => {
  const { handler, calls } = build();
  const response = await request(handler, { body: { id: "evt1", event: "PAYMENT_CREATED" } });
  strictEqual(response.status, 200);
  strictEqual(calls.lookups, 0);
  strictEqual(calls.inserts.length, 0);
});

Deno.test("cobrança desconhecida com token de tenant responde 401", async () => {
  const { handler, calls } = build({ charge: null });
  const response = await request(handler);
  strictEqual(response.status, 401);
  strictEqual(calls.inserts.length, 0);
});

Deno.test("cobrança desconhecida com token global audita e não cria dedupe", async () => {
  const { handler, calls } = build({ charge: null });
  const response = await request(handler, { token: GLOBAL_TOKEN });
  strictEqual(response.status, 200);
  strictEqual(calls.inserts.length, 0);
  strictEqual(calls.audits.length, 1);
  strictEqual(calls.audits[0]?.action, "charge_unknown_webhook");
  strictEqual(calls.audits[0]?.tenant_id, null);
});

Deno.test("token global não substitui o token do tenant", async () => {
  const { handler } = build();
  const response = await request(handler, { token: GLOBAL_TOKEN });
  strictEqual(response.status, 401);
});

Deno.test("token global vale como fallback quando o tenant não tem token", async () => {
  const { handler } = build({ tenantToken: null });
  const response = await request(handler, { token: GLOBAL_TOKEN });
  strictEqual(response.status, 200);
});

Deno.test("nenhum token configurado é fail-closed", async () => {
  const previous = Deno.env.get("ASAAS_WEBHOOK_TOKEN");
  Deno.env.delete("ASAAS_WEBHOOK_TOKEN");
  try {
    const { handler } = build({ tenantToken: null });
    const response = await request(handler, { token: GLOBAL_TOKEN });
    strictEqual(response.status, 401);
  } finally {
    if (previous !== undefined) Deno.env.set("ASAAS_WEBHOOK_TOKEN", previous);
  }
});

Deno.test("PAYMENT_RECEIVED liquida com os seis parâmetros exatos", async () => {
  const { handler, calls } = build();
  const response = await request(handler);
  strictEqual(response.status, 200);
  strictEqual(calls.rpc.length, 1);
  strictEqual(calls.rpc[0]?.name, "settle_charge_payment");
  deepStrictEqual(calls.rpc[0]?.args, {
    p_tenant_id: "t1",
    p_charge_id: "ch1",
    p_paid_at: "2026-11-06T00:00:00.000Z",
    p_source: "asaas",
    p_actor_id: null,
    p_event_id: "evt1",
  });
});

Deno.test("PAYMENT_CONFIRMED também liquida", async () => {
  const { handler, calls } = build();
  const response = await request(handler, {
    body: {
      id: "evt2",
      event: "PAYMENT_CONFIRMED",
      payment: { id: "pay1", value: 100 },
    },
  });
  strictEqual(response.status, 200);
  strictEqual(calls.rpc.length, 1);
  strictEqual(calls.rpc[0]?.args.p_paid_at, null);
});

Deno.test("paymentDate ausente usa confirmedDate", async () => {
  const { handler, calls } = build();
  await request(handler, {
    body: {
      id: "evt3",
      event: "PAYMENT_RECEIVED",
      payment: { id: "pay1", value: 100, confirmedDate: "2026-11-07" },
    },
  });
  strictEqual(calls.rpc[0]?.args.p_paid_at, "2026-11-07T00:00:00.000Z");
});

Deno.test("duplicata já processada responde 200 sem efeito", async () => {
  const { handler, calls } = build({
    insertError: { code: "23505", message: "duplicate key" },
    existing: { processed_at: "2026-11-06T10:00:00.000Z" },
  });
  const response = await request(handler);
  strictEqual(response.status, 200);
  strictEqual(calls.rpc.length, 0);
  strictEqual(calls.chargeUpdates.length, 0);
  strictEqual(calls.finishUpdates.length, 0);
});

Deno.test("23505 com processed_at nulo reprocessa (takeover)", async () => {
  const { handler, calls } = build({
    insertError: { code: "23505", message: "duplicate key" },
    existing: { processed_at: null },
  });
  const response = await request(handler);
  strictEqual(response.status, 200);
  strictEqual(calls.rpc.length, 1);
});

Deno.test("erro de insert diferente de 23505 responde 500 sem processar", async () => {
  const { handler, calls } = build({
    insertError: { code: "08006", message: "connection failure" },
  });
  const response = await request(handler);
  strictEqual(response.status, 500);
  strictEqual(calls.rpc.length, 0);
});

Deno.test("falha ao marcar processed_at responde 500", async () => {
  const { handler, calls } = build({
    finishError: { code: "08006", message: "connection failure" },
  });
  const response = await request(handler);
  strictEqual(response.status, 500);
  strictEqual(calls.rpc.length, 1);
});

Deno.test("PAYMENT_OVERDUE em pendente transiciona para expirado", async () => {
  const { handler, calls } = build();
  const response = await request(handler, {
    body: { id: "evt9", event: "PAYMENT_OVERDUE", payment: { id: "pay1" } },
  });
  strictEqual(response.status, 200);
  strictEqual(calls.chargeUpdates.length, 1);
  deepStrictEqual(calls.chargeUpdates[0]?.values, { status: "expirado" });
  deepStrictEqual(calls.chargeUpdates[0]?.filters, [
    ["tenant_id", "t1"],
    ["id", "ch1"],
    ["status", "pendente"],
  ]);
  strictEqual(calls.audits[0]?.action, "charge_expired");
});

Deno.test("PAYMENT_OVERDUE em pago não emite update", async () => {
  const { handler, calls } = build({
    charge: { ...DEFAULT_CHARGE, status: "pago" },
  });
  const response = await request(handler, {
    body: { id: "evt10", event: "PAYMENT_OVERDUE", payment: { id: "pay1" } },
  });
  strictEqual(response.status, 200);
  strictEqual(calls.chargeUpdates.length, 0);
  strictEqual(calls.audits.length, 0);
});

Deno.test("retry de overdue já aplicado grava a auditoria que faltou", async () => {
  const { handler, calls } = build({
    charge: { ...DEFAULT_CHARGE, status: "expirado" },
    existingAudit: null,
  });
  const response = await request(handler, {
    body: { id: "evt9", event: "PAYMENT_OVERDUE", payment: { id: "pay1" } },
  });
  strictEqual(response.status, 200);
  strictEqual(calls.chargeUpdates.length, 0);
  strictEqual(calls.auditReads, 1);
  strictEqual(calls.audits.length, 1);
  strictEqual(calls.audits[0]?.action, "charge_expired");
  strictEqual((calls.audits[0]?.metadata as { event_id: string }).event_id, "evt9");
});

Deno.test("retry de overdue já auditado não duplica auditoria", async () => {
  const { handler, calls } = build({
    charge: { ...DEFAULT_CHARGE, status: "expirado" },
    existingAudit: { id: "audit-1" },
  });
  const response = await request(handler, {
    body: { id: "evt9", event: "PAYMENT_OVERDUE", payment: { id: "pay1" } },
  });
  strictEqual(response.status, 200);
  strictEqual(calls.chargeUpdates.length, 0);
  strictEqual(calls.auditReads, 1);
  strictEqual(calls.audits.length, 0);
});

Deno.test("retry de overdue com auditorias duplicadas não falha e não duplica", async () => {
  const { handler, calls } = build({
    charge: { ...DEFAULT_CHARGE, status: "expirado" },
    existingAudits: [{ id: "audit-1" }, { id: "audit-2" }],
  });
  const response = await request(handler, {
    body: { id: "evt9", event: "PAYMENT_OVERDUE", payment: { id: "pay1" } },
  });
  strictEqual(response.status, 200);
  strictEqual(calls.auditReads, 1);
  strictEqual(calls.audits.length, 0);
});

Deno.test("retry de deleted já aplicado grava a auditoria que faltou", async () => {
  const { handler, calls } = build({
    charge: { ...DEFAULT_CHARGE, status: "cancelado" },
    existingAudit: null,
  });
  const response = await request(handler, {
    body: { id: "evt11", event: "PAYMENT_DELETED", payment: { id: "pay1" } },
  });
  strictEqual(response.status, 200);
  strictEqual(calls.chargeUpdates.length, 0);
  strictEqual(calls.audits.length, 1);
  strictEqual(calls.audits[0]?.action, "charge_deleted_gateway");
});

Deno.test("PAYMENT_DELETED em pendente transiciona para cancelado", async () => {
  const { handler, calls } = build();
  const response = await request(handler, {
    body: { id: "evt11", event: "PAYMENT_DELETED", payment: { id: "pay1" } },
  });
  strictEqual(response.status, 200);
  deepStrictEqual(calls.chargeUpdates[0]?.values, { status: "cancelado" });
  strictEqual(calls.audits[0]?.action, "charge_deleted_gateway");
});

Deno.test("refund/chargeback audita e não chama RPC nem update", async () => {
  const { handler, calls } = build();
  const response = await request(handler, {
    body: { id: "evt12", event: "PAYMENT_PARTIALLY_REFUNDED", payment: { id: "pay1" } },
  });
  strictEqual(response.status, 200);
  strictEqual(calls.rpc.length, 0);
  strictEqual(calls.chargeUpdates.length, 0);
  strictEqual(calls.audits[0]?.action, "gateway_refund_out_of_scope");
  strictEqual(calls.finishUpdates.length, 1);
});

Deno.test("anomalia do settle responde 200 sem auditoria duplicada", async () => {
  const { handler, calls } = build({
    rpcData: { ok: true, anomaly: "charge_paid_after_cancel", replayed: false },
  });
  const response = await request(handler);
  strictEqual(response.status, 200);
  strictEqual(calls.audits.length, 0);
  strictEqual(calls.finishUpdates.length, 1);
});

Deno.test("CHARGE_NOT_APPOINTMENT do settle responde 200 e loga o código", async () => {
  const captured = captureLogs();
  try {
    const { handler, calls } = build({
      rpcError: { code: "PT409", message: "CHARGE_NOT_APPOINTMENT" },
    });
    const response = await request(handler);
    strictEqual(response.status, 200);
    strictEqual(calls.audits.length, 0);
    strictEqual(captured.lines.some((line) => line.includes("CHARGE_NOT_APPOINTMENT")), true);
  } finally {
    captured.restore();
  }
});

Deno.test("erro genérico do settle responde 500 sem marcar processed_at", async () => {
  const { handler, calls } = build({
    rpcError: { code: "XX000", message: "boom" },
  });
  const response = await request(handler);
  strictEqual(response.status, 500);
  strictEqual(calls.finishUpdates.length, 0);
  strictEqual(calls.audits.length, 0);
});

Deno.test("valor divergente audita anomalia e liquida pelo valor da cobrança", async () => {
  const { handler, calls } = build();
  const response = await request(handler, {
    body: {
      id: "evt13",
      event: "PAYMENT_RECEIVED",
      payment: { id: "pay1", value: 20, paymentDate: "2026-11-06" },
    },
  });
  strictEqual(response.status, 200);
  strictEqual(calls.rpc.length, 1);
  const mismatch = calls.audits.find((row) => row.action === "payment_amount_mismatch");
  strictEqual(mismatch !== undefined, true);
  deepStrictEqual(mismatch?.metadata, {
    event_id: "evt13",
    event_type: "PAYMENT_RECEIVED",
    charge_id: "ch1",
    amount_cents: 10_000,
    payment_value_cents: 2_000,
  });
});

Deno.test("valor do gateway ausente não gera anomalia", async () => {
  const { handler, calls } = build();
  await request(handler, {
    body: { id: "evt14", event: "PAYMENT_RECEIVED", payment: { id: "pay1" } },
  });
  strictEqual(calls.audits.length, 0);
});

Deno.test("log do webhook não vaza payload, QR ou token", async () => {
  const captured = captureLogs();
  try {
    const { handler } = build();
    const response = await request(handler, {
      body: {
        id: "evt15",
        event: "PAYMENT_RECEIVED",
        payment: {
          id: "pay1",
          value: 100,
          paymentDate: "2026-11-06",
          qrCode: "00020126580014",
          name: "Fulano",
          phone: "11999999999",
        },
      },
    });
    strictEqual(response.status, 200);
    const rendered = captured.lines.join("\n");
    for (const forbidden of [
      "00020126580014",
      "Fulano",
      "11999999999",
      TENANT_TOKEN,
      GLOBAL_TOKEN,
      '"qrCode"',
      '"value"',
    ]) {
      strictEqual(rendered.includes(forbidden), false, `log vazou ${forbidden}`);
    }
  } finally {
    captured.restore();
  }
});
