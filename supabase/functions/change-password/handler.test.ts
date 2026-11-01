// Testes do handler da Edge Function `change-password` (ADR-04) com client fake.
// Rodar com: `deno test --allow-env supabase/functions/change-password/`.
//
// O handler recebe o client por injeção, então estes testes cobrem a ordem da troca sem banco:
// autenticação pelo JWT (401 e 403 do GoTrue), validação do corpo (inclusive JSON malformado),
// recusa do flag já limpo, a escrita única no Auth, a classificação dos erros do GoTrue por status
// (400/422 → 400; 401/403/404/409 → 500; 429/5xx/rede → 503), falha ao criar o client e o
// encerramento best-effort das outras sessões. Nenhum teste imprime senha nem id.
import { deepStrictEqual, strictEqual } from "node:assert/strict";
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { createChangePasswordHandler, type ChangePasswordHandlerOptions } from "./handler.ts";
import { PROVISIONAL_PASSWORD } from "../_shared/super-admin-bootstrap.ts";

const USER_ID = "u-teste-adr04";
const TOKEN = "jwt-de-teste";
const APP_METADATA = {
  provider: "email",
  providers: ["email"],
  must_change_password: true,
};

type FakeError = { status?: number } | null;

type FakeUser = { id: string; app_metadata?: unknown };

type FakeOptions = {
  /** Usuário devolvido por `getUser`. `null` = token sem usuário. */
  user?: FakeUser | null;
  getUserError?: FakeError;
  updateError?: FakeError;
  updateThrows?: boolean;
  signOutError?: FakeError;
  signOutThrows?: boolean;
};

type FakeCalls = {
  getUser: string[];
  updateUserById: Array<{ id: string; attributes: unknown }>;
  signOut: Array<{ jwt: string; scope: string | undefined }>;
};

function fakeService(options: FakeOptions): { service: SupabaseClient; calls: FakeCalls } {
  const calls: FakeCalls = { getUser: [], updateUserById: [], signOut: [] };
  const user =
    options.user === undefined
      ? { id: USER_ID, app_metadata: APP_METADATA }
      : options.user;

  const service = {
    auth: {
      getUser: async (token: string) => {
        calls.getUser.push(token);
        if (options.getUserError) return { data: { user: null }, error: options.getUserError };
        return { data: { user }, error: null };
      },
      admin: {
        updateUserById: async (id: string, attributes: unknown) => {
          calls.updateUserById.push({ id, attributes });
          if (options.updateThrows) throw new TypeError("network down");
          if (options.updateError) return { data: { user: null }, error: options.updateError };
          return { data: { user: { id } }, error: null };
        },
        signOut: async (jwt: string, scope?: string) => {
          calls.signOut.push({ jwt, scope });
          if (options.signOutThrows) throw new TypeError("network down");
          if (options.signOutError) return { error: options.signOutError };
          return { error: null };
        },
      },
    },
  };

  return { service: service as unknown as SupabaseClient, calls };
}

function build(
  options: FakeOptions = {},
  overrides: { createServiceThrows?: boolean } = {},
) {
  const fake = fakeService(options);
  const handler = createChangePasswordHandler({
    createService: () => {
      if (overrides.createServiceThrows) {
        throw new Error("Configuração do servidor ausente (SUPABASE_URL/SERVICE_ROLE_KEY).");
      }
      return fake.service;
    },
  } satisfies ChangePasswordHandlerOptions);
  return { handler, calls: fake.calls };
}

async function call(
  handler: (req: Request) => Promise<Response>,
  init: { method?: string; token?: string | null; body?: unknown; rawBody?: string } = {},
): Promise<Response> {
  const headers: Record<string, string> = {};
  const token = init.token === undefined ? TOKEN : init.token;
  if (token !== null) headers.Authorization = `Bearer ${token}`;

  const method = init.method ?? "POST";
  const body = init.rawBody ?? JSON.stringify(init.body ?? { password: "Senha@123" });

  return handler(
    new Request("http://localhost/functions/v1/change-password", {
      method,
      headers,
      body: method === "POST" ? body : undefined,
    }),
  );
}

async function readCode(response: Response): Promise<string | undefined> {
  const body = (await response.json()) as { code?: string };
  return body.code;
}

Deno.test("sem JWT responde 401 e não chama o Auth", async () => {
  const { handler, calls } = build();
  const response = await call(handler, { token: null });

  strictEqual(response.status, 401);
  strictEqual(await readCode(response), "unauthenticated");
  deepStrictEqual(calls.getUser, []);
  deepStrictEqual(calls.updateUserById, []);
  deepStrictEqual(calls.signOut, []);
});

Deno.test("JWT recusado pelo GoTrue responde 401 sem tocar na senha", async () => {
  const { handler, calls } = build({ getUserError: { status: 401 } });
  const response = await call(handler);

  strictEqual(response.status, 401);
  strictEqual(await readCode(response), "unauthenticated");
  deepStrictEqual(calls.updateUserById, []);
});

Deno.test("getUser 403 vira 503 auth_indisponivel, não sessão expirada", async () => {
  // 403 com client de service role é o GoTrue recusando a CHAMADA (chave/papel ou conta
  // bloqueada): problema de servidor. Mandar 401 jogaria o usuário ao login por causa de
  // infraestrutura, então a decisão é 503, com log de servidor e sem detalhe no corpo.
  const { handler, calls } = build({ getUserError: { status: 403 } });
  const response = await call(handler);
  const text = await response.text();

  strictEqual(response.status, 503);
  strictEqual(JSON.parse(text).code, "auth_indisponivel");
  strictEqual(/forbidden|unauthorized|service_role/i.test(text), false);
  deepStrictEqual(calls.updateUserById, []);
  deepStrictEqual(calls.signOut, []);
});

Deno.test("token sem usuário responde 401", async () => {
  const { handler, calls } = build({ user: null });
  const response = await call(handler);

  strictEqual(response.status, 401);
  strictEqual(await readCode(response), "unauthenticated");
  deepStrictEqual(calls.updateUserById, []);
});

Deno.test("GoTrue indisponível no getUser responde 503 auth_indisponivel", async () => {
  const { handler, calls } = build({ getUserError: { status: 503 } });
  const response = await call(handler);

  strictEqual(response.status, 503);
  strictEqual(await readCode(response), "auth_indisponivel");
  deepStrictEqual(calls.updateUserById, []);
});

Deno.test("createService falhando responde 500 internal_error sem chamar o Auth", async () => {
  const { handler, calls } = build({}, { createServiceThrows: true });
  const response = await call(handler);
  const body = (await response.json()) as { code?: string; message?: string };

  strictEqual(response.status, 500);
  strictEqual(body.code, "internal_error");
  // Nenhum nome de variável de ambiente ou chave chega ao cliente.
  strictEqual(
    /SUPABASE|SERVICE_ROLE|service_role/i.test(`${body.code} ${body.message}`),
    false,
  );
  deepStrictEqual(calls.getUser, []);
  deepStrictEqual(calls.updateUserById, []);
});

Deno.test("corpo que não é JSON responde 400 invalid_body", async () => {
  const { handler, calls } = build();
  const response = await call(handler, { rawBody: '{ "password": ' });

  strictEqual(response.status, 400);
  strictEqual(await readCode(response), "invalid_body");
  deepStrictEqual(calls.updateUserById, []);
  deepStrictEqual(calls.signOut, []);
});

Deno.test("campo extra no corpo responde 400 invalid_body e nada é gravado", async () => {
  const { handler, calls } = build();
  const response = await call(handler, {
    body: { password: "Senha@123", user_id: "outro" },
  });

  strictEqual(response.status, 400);
  strictEqual(await readCode(response), "invalid_body");
  deepStrictEqual(calls.updateUserById, []);
  deepStrictEqual(calls.signOut, []);
});

Deno.test("senha de 7 caracteres responde 400 password_too_short", async () => {
  const { handler, calls } = build();
  const response = await call(handler, { body: { password: "Abc@123" } });

  strictEqual(response.status, 400);
  strictEqual(await readCode(response), "password_too_short");
  deepStrictEqual(calls.updateUserById, []);
});

Deno.test("senha de 72 bytes com acento é aceita", async () => {
  const password = "é".repeat(36);
  const { handler, calls } = build();
  const response = await call(handler, { body: { password } });

  strictEqual(response.status, 200);
  deepStrictEqual(await response.json(), { ok: true });
  deepStrictEqual(calls.updateUserById[0]?.attributes, {
    password,
    app_metadata: { ...APP_METADATA, must_change_password: false },
  });
});

Deno.test("senha de 73 bytes responde 400 password_too_long", async () => {
  const { handler, calls } = build();
  const response = await call(handler, { body: { password: `${"é".repeat(36)}a` } });

  strictEqual(response.status, 400);
  strictEqual(await readCode(response), "password_too_long");
  deepStrictEqual(calls.updateUserById, []);
});

Deno.test("senha igual à provisória responde 400 password_is_initial", async () => {
  const { handler, calls } = build();
  const response = await call(handler, { body: { password: PROVISIONAL_PASSWORD } });

  strictEqual(response.status, 400);
  strictEqual(await readCode(response), "password_is_initial");
  deepStrictEqual(calls.updateUserById, []);
});

Deno.test("flag já limpa responde 409 password_change_not_required", async () => {
  const { handler, calls } = build({
    user: { id: USER_ID, app_metadata: { ...APP_METADATA, must_change_password: false } },
  });
  const response = await call(handler);

  strictEqual(response.status, 409);
  strictEqual(await readCode(response), "password_change_not_required");
  deepStrictEqual(calls.updateUserById, []);
  deepStrictEqual(calls.signOut, []);
});

Deno.test("app_metadata sem a flag responde 409 e não grava", async () => {
  const { handler, calls } = build({ user: { id: USER_ID, app_metadata: { provider: "email" } } });
  const response = await call(handler);

  strictEqual(response.status, 409);
  strictEqual(await readCode(response), "password_change_not_required");
  deepStrictEqual(calls.updateUserById, []);
});

Deno.test("sucesso grava senha e flag numa chamada e encerra as outras sessões", async () => {
  const { handler, calls } = build();
  const response = await call(handler);

  strictEqual(response.status, 200);
  const body = (await response.json()) as Record<string, unknown>;
  deepStrictEqual(body, { ok: true });

  strictEqual(calls.updateUserById.length, 1);
  deepStrictEqual(calls.updateUserById[0], {
    id: USER_ID,
    attributes: {
      password: "Senha@123",
      app_metadata: { ...APP_METADATA, must_change_password: false },
    },
  });
  deepStrictEqual(calls.signOut, [{ jwt: TOKEN, scope: "others" }]);
});

Deno.test("resposta de sucesso não ecoa a senha", async () => {
  const password = "Segredo!Unico#42";
  const { handler } = build();
  const response = await call(handler, { body: { password } });
  const text = await response.text();

  strictEqual(response.status, 200);
  strictEqual(text.includes(password), false);
  strictEqual(/hash|service_role|serviceRole/i.test(text), false);
});

Deno.test("falha do signOut não desfaz a troca", async () => {
  const { handler, calls } = build({ signOutError: { status: 500 } });
  const response = await call(handler);

  strictEqual(response.status, 200);
  deepStrictEqual(await response.json(), { ok: true });
  strictEqual(calls.updateUserById.length, 1);
  deepStrictEqual(calls.signOut, [{ jwt: TOKEN, scope: "others" }]);
});

Deno.test("signOut que lança não desfaz a troca", async () => {
  const { handler, calls } = build({ signOutThrows: true });
  const response = await call(handler);

  strictEqual(response.status, 200);
  strictEqual(calls.updateUserById.length, 1);
});

// Classificação do erro do GoTrue na escrita, por status — nenhum ramo lê a mensagem.
const WRITE_FAILURES: Array<{
  label: string;
  status: number | undefined;
  expectedStatus: number;
  expectedCode: string;
}> = [
  { label: "400 (senha recusada)", status: 400, expectedStatus: 400, expectedCode: "password_rejected" },
  { label: "422 (senha recusada)", status: 422, expectedStatus: 400, expectedCode: "password_rejected" },
  { label: "401 (service role recusada)", status: 401, expectedStatus: 500, expectedCode: "internal_error" },
  { label: "403 (service role recusada)", status: 403, expectedStatus: 500, expectedCode: "internal_error" },
  { label: "404 (usuário do JWT ausente)", status: 404, expectedStatus: 500, expectedCode: "internal_error" },
  { label: "409 (conflito do Auth)", status: 409, expectedStatus: 500, expectedCode: "internal_error" },
  { label: "429 (rate limit)", status: 429, expectedStatus: 503, expectedCode: "auth_indisponivel" },
  { label: "500", status: 500, expectedStatus: 503, expectedCode: "auth_indisponivel" },
  { label: "503", status: 503, expectedStatus: 503, expectedCode: "auth_indisponivel" },
  { label: "sem status", status: undefined, expectedStatus: 503, expectedCode: "auth_indisponivel" },
];

for (const failure of WRITE_FAILURES) {
  Deno.test(`escrita com erro ${failure.label} responde ${failure.expectedStatus} ${failure.expectedCode}`, async () => {
    const { handler, calls } = build({ updateError: { status: failure.status } });
    const response = await call(handler);
    const text = await response.text();

    strictEqual(response.status, failure.expectedStatus);
    strictEqual(JSON.parse(text).code, failure.expectedCode);
    // Nenhum detalhe do GoTrue vaza no corpo.
    strictEqual(/forbidden|unauthorized|rate limit|service_role|bcrypt/i.test(text), false);
    // Erro na escrita nunca chega ao signOut (nada foi trocado).
    deepStrictEqual(calls.signOut, []);
  });
}

Deno.test("erro de rede na escrita responde 503 auth_indisponivel", async () => {
  const { handler, calls } = build({ updateThrows: true });
  const response = await call(handler);

  strictEqual(response.status, 503);
  strictEqual(await readCode(response), "auth_indisponivel");
  deepStrictEqual(calls.signOut, []);
});

Deno.test("OPTIONS responde 200 e método não-POST responde 405", async () => {
  const { handler, calls } = build();

  const preflight = await call(handler, { method: "OPTIONS", token: null });
  strictEqual(preflight.status, 200);

  const get = await call(handler, { method: "GET" });
  strictEqual(get.status, 405);
  strictEqual(await readCode(get), "method_not_allowed");
  deepStrictEqual(calls.getUser, []);
});
