// Testes do handler HTTP do hook `custom_access_token` — ADR-01. Rodar com:
//   npm run test:functions
// Cobre os caminhos que não dependem do banco: 405, 401 (assinatura, timestamp), 400 (corpo) e
// 500 (segredo ausente). O caminho 200 com perfil real é verificado no stack local (critério 4).
import { strictEqual as assertEquals } from "node:assert/strict";
import { handleHookRequest } from "./handler.ts";

const SECRET_ENV = "CUSTOM_ACCESS_TOKEN_HOOK_SECRET";
const USER_ID = "7f1c2a3e-8b4d-4e5f-9a6b-1c2d3e4f5a6b";

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** Gera um segredo no formato `v1,whsec_<base64>` com 32 bytes aleatórios. */
function newSecret(): { secret: string; key: Uint8Array<ArrayBuffer> } {
  const key = new Uint8Array(new ArrayBuffer(32));
  crypto.getRandomValues(key);
  return { secret: `v1,whsec_${toBase64(key)}`, key };
}

async function sign(
  key: Uint8Array<ArrayBuffer>,
  messageId: string,
  timestamp: string,
  body: string,
): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    key,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign(
    "HMAC",
    cryptoKey,
    new TextEncoder().encode(`${messageId}.${timestamp}.${body}`),
  );
  return `v1,${toBase64(new Uint8Array(mac))}`;
}

function nowSeconds(): string {
  return String(Math.floor(Date.now() / 1000));
}

async function signedRequest(
  key: Uint8Array<ArrayBuffer>,
  body: string,
  timestamp: string = nowSeconds(),
): Promise<Request> {
  const messageId = `msg_${crypto.randomUUID()}`;
  return new Request("http://localhost/custom-access-token", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "webhook-id": messageId,
      "webhook-timestamp": timestamp,
      "webhook-signature": await sign(key, messageId, timestamp, body),
    },
    body,
  });
}

/** Roda `fn` com o segredo do hook definido (ou removido, se `value` for undefined). */
async function withSecretEnv(value: string | undefined, fn: () => Promise<void>): Promise<void> {
  const previous = Deno.env.get(SECRET_ENV);
  if (value === undefined) Deno.env.delete(SECRET_ENV);
  else Deno.env.set(SECRET_ENV, value);
  try {
    await fn();
  } finally {
    if (previous === undefined) Deno.env.delete(SECRET_ENV);
    else Deno.env.set(SECRET_ENV, previous);
  }
}

const validBody = JSON.stringify({ user_id: USER_ID, claims: { sub: USER_ID, role: "authenticated" } });

Deno.test("recusa método diferente de POST com 405", async () => {
  const res = await handleHookRequest(new Request("http://localhost/", { method: "GET" }));
  assertEquals(res.status, 405);
});

Deno.test("sem cabeçalhos de assinatura responde 401", async () => {
  await withSecretEnv(newSecret().secret, async () => {
    const res = await handleHookRequest(
      new Request("http://localhost/", { method: "POST", body: validBody }),
    );
    assertEquals(res.status, 401);
    assertEquals((await res.json()).code, "unauthorized");
  });
});

Deno.test("assinatura feita com outra chave responde 401", async () => {
  const configured = newSecret();
  const attacker = newSecret();
  await withSecretEnv(configured.secret, async () => {
    const req = await signedRequest(attacker.key, validBody);
    const res = await handleHookRequest(req);
    assertEquals(res.status, 401);
  });
});

Deno.test("timestamp fora da janela de 300 s responde 401", async () => {
  const { secret, key } = newSecret();
  const oneHourAgo = String(Math.floor(Date.now() / 1000) - 3600);
  await withSecretEnv(secret, async () => {
    const res = await handleHookRequest(await signedRequest(key, validBody, oneHourAgo));
    assertEquals(res.status, 401);
  });
});

Deno.test("corpo assinado sem user_id responde 400", async () => {
  const { secret, key } = newSecret();
  await withSecretEnv(secret, async () => {
    const body = JSON.stringify({ claims: {} });
    const res = await handleHookRequest(await signedRequest(key, body));
    assertEquals(res.status, 400);
    assertEquals((await res.json()).code, "invalid_body");
  });
});

Deno.test("corpo assinado que não é JSON responde 400", async () => {
  const { secret, key } = newSecret();
  await withSecretEnv(secret, async () => {
    const res = await handleHookRequest(await signedRequest(key, "{não é json"));
    assertEquals(res.status, 400);
  });
});

Deno.test("segredo ausente no ambiente responde 500 sem liberar o login", async () => {
  await withSecretEnv(undefined, async () => {
    const res = await handleHookRequest(
      new Request("http://localhost/", { method: "POST", body: validBody }),
    );
    assertEquals(res.status, 500);
    assertEquals((await res.json()).code, "identity_unavailable");
  });
});

Deno.test("perfil inativo responde 200 com claim active=false", async () => {
  const { secret, key } = newSecret();
  const TENANT_ID = "2b3c4d5e-6f70-4a8b-9c0d-1e2f3a4b5c6d";
  const fakeService = {
    from: (_table: string) => ({
      select: (_cols: string) => ({
        eq: (_col: string, _val: string) => ({
          maybeSingle: async () => ({
            data: { role: "professional", tenant_id: TENANT_ID, active: false },
            error: null,
          }),
        }),
      }),
    }),
  } as unknown as import("jsr:@supabase/supabase-js@2").SupabaseClient;

  await withSecretEnv(secret, async () => {
    const req = await signedRequest(key, validBody);
    const res = await handleHookRequest(req, { serviceClient: fakeService });
    assertEquals(res.status, 200);
    const json = await res.json();
    assertEquals(json.claims.active, false);
    assertEquals(json.claims.user_role, "professional");
  });
});

Deno.test("perfil ausente responde 200 com claims mínimas", async () => {
  const { secret, key } = newSecret();
  const fakeService = {
    from: (_table: string) => ({
      select: (_cols: string) => ({
        eq: (_col: string, _val: string) => ({
          maybeSingle: async () => ({ data: null, error: null }),
        }),
      }),
    }),
  } as unknown as import("jsr:@supabase/supabase-js@2").SupabaseClient;

  await withSecretEnv(secret, async () => {
    const req = await signedRequest(key, validBody);
    const res = await handleHookRequest(req, { serviceClient: fakeService });
    assertEquals(res.status, 200);
    const json = await res.json();
    assertEquals(json.claims.user_role, null);
    assertEquals(json.claims.tenant_id, null);
    assertEquals(json.claims.active, false);
    assertEquals(json.claims.role, "authenticated");
  });
});

Deno.test("erro de leitura do banco responde 500", async () => {
  const { secret, key } = newSecret();
  const fakeService = {
    from: (_table: string) => ({
      select: (_cols: string) => ({
        eq: (_col: string, _val: string) => ({
          maybeSingle: async () => ({ data: null, error: { code: "PGRST" } }),
        }),
      }),
    }),
  } as unknown as import("jsr:@supabase/supabase-js@2").SupabaseClient;

  await withSecretEnv(secret, async () => {
    const req = await signedRequest(key, validBody);
    const res = await handleHookRequest(req, { serviceClient: fakeService });
    assertEquals(res.status, 500);
  });
});
