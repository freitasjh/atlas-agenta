import { deepStrictEqual, strictEqual } from "node:assert/strict";
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import {
  createHandler,
  hourInTimezone,
  isWithinSendWindow,
  renderCampaignBody,
} from "./handler.ts";

Deno.test("pure — renderCampaignBody substitui variáveis e usa fallback", () => {
  strictEqual(
    renderCampaignBody("Olá {nome}, novidade da {empresa}!", "Ana", "Salão X"),
    "Olá Ana, novidade da Salão X!",
  );
  strictEqual(renderCampaignBody("Oi {nome}!", null, null), "Oi cliente!");
});

Deno.test("pure — isWithinSendWindow com janela normal e cruzando meia-noite", () => {
  strictEqual(isWithinSendWindow(10, 9, 18), true);
  strictEqual(isWithinSendWindow(8, 9, 18), false);
  strictEqual(isWithinSendWindow(18, 9, 18), false);
  strictEqual(isWithinSendWindow(23, 22, 6), true);
  strictEqual(isWithinSendWindow(3, 22, 6), true);
  strictEqual(isWithinSendWindow(12, 22, 6), false);
});

Deno.test("pure — hourInTimezone respeita o fuso do tenant", () => {
  // 12:00 UTC = 09:00 em America/Sao_Paulo (UTC-3, sem horário de verão).
  strictEqual(
    hourInTimezone(new Date("2026-11-20T12:00:00.000Z"), "America/Sao_Paulo"),
    9,
  );
});

type Row = Record<string, unknown>;

interface FakeDb {
  campaign: Row | null;
  tenant: Row | null;
  planFeatures: string[] | null;
  template: Row | null;
  instance: Row | null;
  customers: Record<string, Row>;
  claimed: Row[];
  sentCounts: Record<string, number>;
  remaining: number;
  updates: Array<{ table: string; values: Row; id: string }>;
  sentTexts: Array<{ to: string; text: string }>;
}

function fakeService(db: FakeDb): SupabaseClient {
  const table = (name: string) => {
    const query: any = {
      select: (_cols?: string, opts?: { count?: string; head?: boolean }) => {
        if (opts?.head) {
          return {
            eq: () => query,
            neq: () => query,
            gte: () =>
              Promise.resolve({
                count: name === "campaign_sends" && _cols === "id" &&
                    (query as any).__mode === "freq"
                  ? (db.sentCounts[(query as any).__customer] ?? 0)
                  : db.remaining,
                error: null,
              }),
          };
        }
        return query;
      },
      eq: (col: string, value: unknown) => {
        (query as any).__eq = { ...(query as any).__eq, [col]: value };
        return query;
      },
      neq: () => query,
      gte: () => query,
      maybeSingle: async () => {
        if (name === "campaigns") return { data: db.campaign, error: null };
        if (name === "tenants") return { data: db.tenant, error: null };
        if (name === "plans") {
          return {
            data: db.planFeatures ? { features: db.planFeatures } : null,
            error: null,
          };
        }
        if (name === "campaign_templates") return { data: db.template, error: null };
        if (name === "whatsapp_instances") return { data: db.instance, error: null };
        if (name === "customers") {
          const id = (query as any).__eq?.["id"] as string | undefined;
          return { data: (id && db.customers[id]) ?? null, error: null };
        }
        return { data: null, error: null };
      },
      update: (values: Row) => ({
        eq: async (col: string, value: unknown) => {
          db.updates.push({ table: name, values, id: String(value) });
          return { error: null };
        },
      }),
      then: undefined,
    };
    // Marca consultas de frequência (neq campaign_id presente) para o head resolver a contagem.
    const origEq = query.eq;
    query.eq = (col: string, value: unknown) => {
      if (name === "campaign_sends" && col === "customer_id") {
        (query as any).__customer = String(value);
      }
      if (name === "campaign_sends" && col === "campaign_id" && (query as any).__neqSeen) {
        (query as any).__mode = "freq";
      }
      return origEq(col, value);
    };
    const origNeq = query.neq;
    query.neq = () => {
      (query as any).__neqSeen = true;
      (query as any).__mode = "freq";
      return origNeq();
    };
    return query;
  };

  return {
    from: (name: string) => table(name),
    rpc: async (fn: string, _args: Row) => {
      if (fn === "campaign_release_stale_claims") return { data: 0, error: null };
      if (fn === "campaign_claim_sends") return { data: db.claimed, error: null };
      throw new Error(`rpc inesperada: ${fn}`);
    },
  } as unknown as SupabaseClient;
}

function baseDb(): FakeDb {
  return {
    campaign: {
      id: "c1",
      tenant_id: "t1",
      template_id: "tpl1",
      require_approved_template: true,
      send_start_hour: 0,
      send_end_hour: 23,
      max_per_customer_30d: 1,
      status: "enviando",
    },
    tenant: {
      plan: "premium",
      subscription_status: "ativo",
      timezone: "America/Sao_Paulo",
      trade_name: "Salão X",
      legal_name: null,
    },
    planFeatures: ["campanhas"],
    template: { body: "Olá {nome} da {empresa}!", approved_outside_24h: true, active: true },
    instance: { evolution_instance_name: "inst1", connection_status: "conectado" },
    customers: {
      u1: { name: "Ana", phone: "5511999990001", whatsapp_opt_in: true, active: true },
    },
    claimed: [{ send_id: "s1", tenant_id: "t1", customer_id: "u1" }],
    sentCounts: {},
    remaining: 0,
    updates: [],
    sentTexts: [],
  };
}

function post(body: unknown): Request {
  return new Request("http://localhost/campaign-dispatch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

Deno.test("handler — caminho feliz envia, grava sent e conclui", async () => {
  const db = baseDb();
  const handler = createHandler({
    createService: () => fakeService(db),
    createAdapter: () => ({
      pair: async () => ({ qrCodeBase64: "" }),
      getConnectionState: async () => ({ state: "open" as const }),
      sendText: async (p: { to: string; text: string }) => {
        db.sentTexts.push({ to: p.to, text: p.text });
        return { providerMessageId: "prov-1" };
      },
    }),
    now: () => new Date("2026-11-20T12:00:00.000Z"),
  });

  const res = await handler(post({ campaign_id: "123e4567-e89b-12d3-a456-426614174000" }));
  strictEqual(res.status, 200);
  const json = await res.json() as Record<string, unknown>;
  strictEqual(json["sent"], 1);
  strictEqual(json["completed"], true);
  deepStrictEqual(db.sentTexts, [{ to: "5511999990001", text: "Olá Ana da Salão X!" }]);
  strictEqual(db.updates.some((u) => u.table === "campaigns"), true);
});

Deno.test("handler — sem opt-in marca excluded_opt_in e nunca chama o provedor", async () => {
  const db = baseDb();
  db.customers["u1"] = { name: "Bia", phone: "5511999990002", whatsapp_opt_in: false, active: true };
  let calls = 0;
  const handler = createHandler({
    createService: () => fakeService(db),
    createAdapter: () => ({
      pair: async () => ({ qrCodeBase64: "" }),
      getConnectionState: async () => ({ state: "open" as const }),
      sendText: async () => {
        calls++;
        return { providerMessageId: "prov-x" };
      },
    }),
    now: () => new Date("2026-11-20T12:00:00.000Z"),
  });

  const res = await handler(post({ campaign_id: "123e4567-e89b-12d3-a456-426614174000" }));
  strictEqual(res.status, 200);
  const json = await res.json() as Record<string, unknown>;
  strictEqual(json["excluded_opt_in"], 1);
  strictEqual(calls, 0);
  strictEqual(
    db.updates.some((u) => u.table === "campaign_sends" && u.values["status"] === "excluded_opt_in"),
    true,
  );
});

Deno.test("handler — sem entitlement nega com 403 sem enviar", async () => {
  const db = baseDb();
  db.planFeatures = ["agendamento"];
  let calls = 0;
  const handler = createHandler({
    createService: () => fakeService(db),
    createAdapter: () => ({
      pair: async () => ({ qrCodeBase64: "" }),
      getConnectionState: async () => ({ state: "open" as const }),
      sendText: async () => {
        calls++;
        return { providerMessageId: "prov-x" };
      },
    }),
    now: () => new Date("2026-11-20T12:00:00.000Z"),
  });

  const res = await handler(post({ campaign_id: "123e4567-e89b-12d3-a456-426614174000" }));
  strictEqual(res.status, 403);
  strictEqual(calls, 0);
});

Deno.test("handler — template não aprovado fora da janela nega sem enviar", async () => {
  const db = baseDb();
  db.template = { body: "Oi", approved_outside_24h: false, active: true };
  let calls = 0;
  const handler = createHandler({
    createService: () => fakeService(db),
    createAdapter: () => ({
      pair: async () => ({ qrCodeBase64: "" }),
      getConnectionState: async () => ({ state: "open" as const }),
      sendText: async () => {
        calls++;
        return { providerMessageId: "prov-x" };
      },
    }),
    now: () => new Date("2026-11-20T12:00:00.000Z"),
  });

  const res = await handler(post({ campaign_id: "123e4567-e89b-12d3-a456-426614174000" }));
  strictEqual(res.status, 400);
  const json = await res.json() as Record<string, unknown>;
  strictEqual(json["error"], "template_not_approved");
  strictEqual(calls, 0);
});
