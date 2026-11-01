// Testes do handler da Edge Function `bootstrap-super-admin` (ADR-05) com client fake.
// Rodar com: `deno test --allow-env supabase/functions/bootstrap-super-admin/`.
//
// O handler recebe o client e o ambiente por injeção, então estes testes cobrem os caminhos de
// erro sem banco: corrida do `createUser`, rollback do profile, usuário sem profile e a regra do
// 404 antes do método. Nenhum teste imprime segredo, senha ou e-mail.
import { deepStrictEqual, strictEqual } from "node:assert/strict";
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import {
  createBootstrapHandler,
  type BootstrapEnv,
  type BootstrapHandlerOptions,
} from "./handler.ts";
import { BOOTSTRAP_SECRET_HEADER } from "./schemas.ts";
import { SUPER_ADMIN_EMAIL } from "../_shared/super-admin-bootstrap.ts";

const SECRET = "segredo-de-teste-adr05";

const ENV: BootstrapEnv = {
  bootstrapSecret: SECRET,
  atlasEnv: "local",
  allowNonLocal: undefined,
};

type FakeUser = { id: string; email: string };
type FakeProfile = { role: string | null; tenant_id: string | null };
type FakeAuthError = { code?: string; status?: number; message?: string } | null;

type FakeOptions = {
  /** Usuários devolvidos em toda chamada de listUsers. */
  users?: FakeUser[];
  /** Usuários por chamada de listUsers (última posição se repete). Usado na corrida. */
  userSequence?: FakeUser[][];
  profiles?: Record<string, FakeProfile>;
  createUser?: () => { data: { user: { id: string } | null }; error: FakeAuthError };
  insertError?: { code?: string } | null;
  listUsersError?: { status?: number } | null;
};

type FakeCalls = {
  createUser: unknown[];
  deleteUser: string[];
  insert: unknown[];
  listUsers: number;
};

function fakeService(options: FakeOptions): { service: SupabaseClient; calls: FakeCalls } {
  const calls: FakeCalls = {
    createUser: [],
    deleteUser: [],
    insert: [],
    listUsers: 0,
  };
  const profiles = options.profiles ?? {};

  const service = {
    auth: {
      admin: {
        listUsers: async () => {
          calls.listUsers += 1;
          if (options.listUsersError) {
            return { data: { users: [], nextPage: null }, error: options.listUsersError };
          }
          const batch = options.userSequence
            ? options.userSequence[Math.min(calls.listUsers - 1, options.userSequence.length - 1)]
            : (options.users ?? []);
          return { data: { users: batch, nextPage: null }, error: null };
        },
        createUser: async (payload: unknown) => {
          calls.createUser.push(payload);
          return options.createUser
            ? options.createUser()
            : { data: { user: { id: "novo-id" } }, error: null };
        },
        deleteUser: async (id: string) => {
          calls.deleteUser.push(id);
          return { data: {}, error: null };
        },
      },
    },
    from: (_table: string) => ({
      select: () => ({
        eq: (_column: string, id: string) => ({
          maybeSingle: async () => ({ data: profiles[id] ?? null, error: null }),
        }),
      }),
      insert: async (row: unknown) => {
        calls.insert.push(row);
        return { data: null, error: options.insertError ?? null };
      },
    }),
  };

  return { service: service as unknown as SupabaseClient, calls };
}

function build(options: FakeOptions = {}, env: BootstrapEnv = ENV) {
  const fake = fakeService(options);
  let serviceCalls = 0;
  const handler = createBootstrapHandler({
    readEnv: () => env,
    createService: () => {
      serviceCalls += 1;
      return fake.service;
    },
  } satisfies BootstrapHandlerOptions);
  return { handler, calls: fake.calls, serviceCalls: () => serviceCalls };
}

async function call(
  handler: (req: Request) => Promise<Response>,
  init: { method?: string; secret?: string | null } = {},
): Promise<Response> {
  const headers: Record<string, string> = {};
  const secret = init.secret === undefined ? SECRET : init.secret;
  if (secret !== null) headers[BOOTSTRAP_SECRET_HEADER] = secret;
  return handler(
    new Request("http://localhost/functions/v1/bootstrap-super-admin", {
      method: init.method ?? "POST",
      headers,
    }),
  );
}

Deno.test("sem BOOTSTRAP_SECRET responde 404 e não toca no banco", async () => {
  const { handler, calls, serviceCalls } = build({ users: [] }, {
    ...ENV,
    bootstrapSecret: undefined,
  });
  const response = await call(handler);
  strictEqual(response.status, 404);
  strictEqual(await response.text(), "");
  strictEqual(serviceCalls(), 0);
  strictEqual(calls.listUsers, 0);
});

Deno.test("sem BOOTSTRAP_SECRET responde 404 também em método não-POST", async () => {
  const { handler } = build({ users: [] }, { ...ENV, bootstrapSecret: undefined });
  const response = await call(handler, { method: "GET" });
  strictEqual(response.status, 404);
  strictEqual(await response.text(), "");
});

Deno.test("segredo errado responde 401 sem tocar no banco", async () => {
  const { handler, serviceCalls } = build({ users: [] });
  const response = await call(handler, { secret: "errado" });
  strictEqual(response.status, 401);
  strictEqual(serviceCalls(), 0);
});

Deno.test("ambiente não local responde 403 sem tocar no banco", async () => {
  const { handler, serviceCalls } = build({ users: [] }, { ...ENV, atlasEnv: "staging" });
  const response = await call(handler);
  strictEqual(response.status, 403);
  strictEqual(serviceCalls(), 0);
});

Deno.test("método não-POST com segredo certo responde 405", async () => {
  const { handler } = build({ users: [] });
  const response = await call(handler, { method: "GET" });
  strictEqual(response.status, 405);
});

Deno.test("sem usuário cria usuário e profile super_admin sem tenant", async () => {
  const { handler, calls } = build({ users: [] });
  const response = await call(handler);

  strictEqual(response.status, 201);
  deepStrictEqual(await response.json(), { status: "criado", user_id: "novo-id" });

  const createPayload = calls.createUser[0] as {
    email?: string;
    app_metadata?: { must_change_password?: boolean };
  };
  strictEqual(createPayload.email, SUPER_ADMIN_EMAIL);
  strictEqual(createPayload.app_metadata?.must_change_password, true);

  deepStrictEqual(calls.insert[0], {
    id: "novo-id",
    tenant_id: null,
    role: "super_admin",
  });
  deepStrictEqual(calls.deleteUser, []);
});

Deno.test("admin de empresa responde 409 email_com_outro_papel e nada é criado", async () => {
  const { handler, calls } = build({
    users: [{ id: "u-admin", email: SUPER_ADMIN_EMAIL }],
    profiles: { "u-admin": { role: "admin", tenant_id: "t-1" } },
  });
  const response = await call(handler);

  strictEqual(response.status, 409);
  const body = (await response.json()) as { code?: string };
  strictEqual(body.code, "email_com_outro_papel");
  deepStrictEqual(calls.createUser, []);
});

Deno.test("usuário sem profile responde 409 usuario_sem_profile com recuperação", async () => {
  const { handler, calls } = build({
    users: [{ id: "u-orfao", email: SUPER_ADMIN_EMAIL }],
    profiles: {},
  });
  const response = await call(handler);

  strictEqual(response.status, 409);
  const body = (await response.json()) as { code?: string; message?: string };
  strictEqual(body.code, "usuario_sem_profile");
  strictEqual(/sem profile/i.test(body.message ?? ""), true);
  strictEqual(/Admin API/.test(body.message ?? ""), true);
  deepStrictEqual(calls.createUser, []);
});

Deno.test("insert do profile falha, remove só o usuário criado e responde 500", async () => {
  const { handler, calls } = build({
    users: [],
    insertError: { code: "23505" },
  });
  const response = await call(handler);

  strictEqual(response.status, 500);
  const body = (await response.json()) as { code?: string };
  strictEqual(body.code, "internal_error");
  deepStrictEqual(calls.deleteUser, ["novo-id"]);
});

Deno.test("corrida: 422 com profile super_admin responde ja_existe", async () => {
  const { handler, calls } = build({
    userSequence: [[], [{ id: "u-1", email: SUPER_ADMIN_EMAIL }]],
    profiles: { "u-1": { role: "super_admin", tenant_id: null } },
    createUser: () => ({
      data: { user: null },
      error: { code: "email_exists", status: 422, message: "User already registered" },
    }),
  });
  const response = await call(handler);

  strictEqual(response.status, 200);
  deepStrictEqual(await response.json(), { status: "ja_existe", user_id: "u-1" });
  deepStrictEqual(calls.deleteUser, []);
});

Deno.test("corrida: 422 sem profile responde bootstrap_em_andamento, não email_com_outro_papel", async () => {
  const { handler } = build({
    userSequence: [[], [{ id: "u-2", email: SUPER_ADMIN_EMAIL }]],
    profiles: {},
    createUser: () => ({
      data: { user: null },
      error: { code: "email_exists", status: 422, message: "User already registered" },
    }),
  });
  const response = await call(handler);

  strictEqual(response.status, 409);
  const body = (await response.json()) as { code?: string };
  strictEqual(body.code, "bootstrap_em_andamento");
});

Deno.test("corrida: 422 sem usuário localizável responde bootstrap_em_andamento", async () => {
  const { handler } = build({
    userSequence: [[], []],
    createUser: () => ({
      data: { user: null },
      error: { code: "email_exists", status: 422, message: "User already registered" },
    }),
  });
  const response = await call(handler);

  strictEqual(response.status, 409);
  const body = (await response.json()) as { code?: string };
  strictEqual(body.code, "bootstrap_em_andamento");
});

Deno.test("corrida: 422 com admin de empresa responde email_com_outro_papel", async () => {
  const { handler } = build({
    userSequence: [[], [{ id: "u-admin", email: SUPER_ADMIN_EMAIL }]],
    profiles: { "u-admin": { role: "admin", tenant_id: "t-1" } },
    createUser: () => ({
      data: { user: null },
      error: { code: "email_exists", status: 422, message: "User already registered" },
    }),
  });
  const response = await call(handler);

  strictEqual(response.status, 409);
  const body = (await response.json()) as { code?: string };
  strictEqual(body.code, "email_com_outro_papel");
});

Deno.test("erro do createUser que não é e-mail duplicado responde 500", async () => {
  const { handler } = build({
    users: [],
    createUser: () => ({
      data: { user: null },
      error: { status: 500, message: "internal" },
    }),
  });
  const response = await call(handler);

  strictEqual(response.status, 500);
});

Deno.test("falha de listUsers responde 500 sem criar nada", async () => {
  const { handler, calls } = build({ listUsersError: { status: 503 } });
  const response = await call(handler);

  strictEqual(response.status, 500);
  deepStrictEqual(calls.createUser, []);
});
