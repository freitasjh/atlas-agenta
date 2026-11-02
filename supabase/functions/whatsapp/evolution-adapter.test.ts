// Testes do RealEvolutionAdapter (ADR-10/ADR-17) —rede HTTP é "stubada" em
// globalThis.fetch: cada teste recebe respostas programadas por caminho/método,
// SEM rede real (o contrato com o Evolution v2.3.7 foi verificado ao vivo).
// Rodar com: deno test --allow-env supabase/functions/whatsapp/
import { strict as assert } from "node:assert/strict";
import {
  type EvolutionHttpResponse,
  evolutionFetch,
  normalizePhoneForEvolution,
  RealEvolutionAdapter,
  toQrDataUrl,
} from "./evolution-adapter.ts";

const CREDENTIALS = { apiUrl: "https://evolution.test", apiKey: "test-key" };

type StubRoute = {
  pathSuffix: string;
  method?: "GET" | "POST";
  respond: EvolutionHttpResponse;
};

let calls: EvolutionHttpResponse[] = [];

/** Substitui fetch global por pilha de respostas programadas por caminho. */
function stubFetch(routes: StubRoute[]): void {
  calls = [];
  globalThis.fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
    const method = (init?.method ?? "GET") as "GET" | "POST";
    const rawUrl = typeof _url === "string" ? _url : _url.toString();
    const call: EvolutionHttpResponse = { status: 0, ok: false, body: null };
    calls.push(call);
    const route = routes.find(
      (r) =>
        rawUrl.endsWith(r.pathSuffix) &&
        (r.method === undefined || r.method === method),
    );
    if (!route) {
      // Rota não programada: progra o chamador para TODAS as chamadas do teste.
      throw new Error(`fetch não programado: ${method} ${rawUrl}`);
    }
    call.status = route.respond.status;
    call.ok = route.respond.ok;
    call.body = route.respond.body;
    return new Response(JSON.stringify(route.respond.body ?? null), {
      status: route.respond.status,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
}

const QR_BODY = {
  base64: "iVBORw0KGgoAAAANSUhEUg==",
  code: "2@...",
  pairingCode: null,
  count: 1,
};

const CREATE_OK = {
  status: 201,
  ok: true,
  body: {
    instance: { instanceName: "tenant-x", instanceId: "i1", status: "connecting" },
    hash: "h",
  },
};

const CREATE_CONFLICT = {
  status: 403,
  ok: false,
  body: { status: 403, error: "Forbidden", response: { message: ["already in use"] } },
};

const CONNECT_MISSING = {
  status: 404,
  ok: false,
  body: { status: 404, error: "Not Found", response: { message: ["instance does not exist"] } },
};

Deno.test("pair: create ok + connect com QR → devolve data URL (ADR-10 happy path)", async () => {
  stubFetch([
    { pathSuffix: "/instance/create", method: "POST", respond: CREATE_OK },
    { pathSuffix: "/instance/connect/tenant-x", method: "GET", respond: { status: 200, ok: true, body: QR_BODY } },
  ]);
  const adapter = new RealEvolutionAdapter(CREDENTIALS.apiUrl, CREDENTIALS.apiKey);
  const result = await adapter.pair("tenant-x");
  assert.equal(result.qrCodeBase64, toQrDataUrl(QR_BODY.base64));
});

Deno.test("pair: create 403 'já existe' é não-fatal → segue para o conectar (R2)", async () => {
  stubFetch([
    { pathSuffix: "/instance/create", method: "POST", respond: CREATE_CONFLICT },
    { pathSuffix: "/instance/connect/tenant-x", method: "GET", respond: { status: 200, ok: true, body: QR_BODY } },
  ]);
  const adapter = new RealEvolutionAdapter(CREDENTIALS.apiUrl, CREDENTIALS.apiKey);
  const result = await adapter.pair("tenant-x");
  assert.equal(result.qrCodeBase64, toQrDataUrl(QR_BODY.base64));
});

Deno.test("pair: connect 404 (instância ausente) → erro ESPECÍFICO, SEM recriar", async () => {
  stubFetch([
    { pathSuffix: "/instance/create", method: "POST", respond: CREATE_CONFLICT },
    { pathSuffix: "/instance/connect/tenant-x", method: "GET", respond: CONNECT_MISSING },
  ]);
  const adapter = new RealEvolutionAdapter(CREDENTIALS.apiUrl, CREDENTIALS.apiKey);
  await assert.rejects(
    () => adapter.pair("tenant-x"),
    (err: Error) => {
      assert.equal(
        err.message,
        "A instância do WhatsApp não existe no servidor de WhatsApp.",
      );
      return true;
    },
  );
  // SEM auto-recriação (rejeitada na ADR-10): só create x1 + connect x1.
  assert.equal(calls.length, 2);
});

Deno.test("pair: connect com erro diferente de 404 → erro genérico de conexão", async () => {
  stubFetch([
    { pathSuffix: "/instance/create", method: "POST", respond: CREATE_OK },
    { pathSuffix: "/instance/connect/tenant-x", method: "GET", respond: { status: 502, ok: false, body: { error: "upstream" } } },
  ]);
  const adapter = new RealEvolutionAdapter(CREDENTIALS.apiUrl, CREDENTIALS.apiKey);
  await assert.rejects(
    () => adapter.pair("tenant-x"),
    (err: Error) => err.message === "Não foi possível conectar o WhatsApp.",
  );
});

Deno.test("pair: create com erro não-conflito → erro de criação", async () => {
  stubFetch([
    { pathSuffix: "/instance/create", method: "POST", respond: { status: 500, ok: false, body: { error: "boom" } } },
  ]);
  const adapter = new RealEvolutionAdapter(CREDENTIALS.apiUrl, CREDENTIALS.apiKey);
  await assert.rejects(
    () => adapter.pair("tenant-x"),
    (err: Error) => err.message === "Não foi possível criar a instância do WhatsApp.",
  );
});

Deno.test("getConnectionState 404 → erro pt-BR (reconciliação segue non-fatal)", async () => {
  stubFetch([
    { pathSuffix: "/instance/connectionState/tenant-x", method: "GET", respond: CONNECT_MISSING },
  ]);
  const adapter = new RealEvolutionAdapter(CREDENTIALS.apiUrl, CREDENTIALS.apiKey);
  await assert.rejects(
    () => adapter.getConnectionState("tenant-x"),
    (err: Error) =>
      err.message === "Não foi possível consultar o estado do WhatsApp.",
  );
});

Deno.test("pair: state 'open' sem QR → erro 'já está conectado'", async () => {
  stubFetch([
    { pathSuffix: "/instance/create", method: "POST", respond: CREATE_OK },
    {
      pathSuffix: "/instance/connect/tenant-x",
      method: "GET",
      respond: {
        status: 200,
        ok: true,
        body: { instance: { instanceName: "tenant-x", state: "open" } },
      },
    },
  ]);
  const adapter = new RealEvolutionAdapter(CREDENTIALS.apiUrl, CREDENTIALS.apiKey);
  await assert.rejects(
    () => adapter.pair("tenant-x"),
    (err: Error) => err.message === "O WhatsApp já está conectado.",
  );
});

Deno.test("normalizePhoneForEvolution: casos de fronteira da ADR-01", () => {
  assert.equal(normalizePhoneForEvolution("11987654321"), "5511987654321");
  assert.equal(normalizePhoneForEvolution("1198765432"), "551198765432");
  assert.equal(normalizePhoneForEvolution("5511987654321"), "5511987654321");
  assert.equal(normalizePhoneForEvolution("+55 11 98765-4321"), "5511987654321");
});

Deno.test("evolutionFetch: timeout de rede → falha pt-BR controlada (R13)", async () => {
  globalThis.fetch = (async (_url, init) => {
    // Cumpre o AbortController: rejeita com AbortError quando abortado.
    return new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => {
        const e = new Error("aborted");
        e.name = "AbortError";
        reject(e);
      });
    });
  }) as typeof fetch;
  await assert.rejects(
    () => evolutionFetch(CREDENTIALS, { method: "GET", path: "/instance/connect/x" }),
    (err: Error) => err.message === "Falha de comunicação com o servidor de WhatsApp.",
  );
});
