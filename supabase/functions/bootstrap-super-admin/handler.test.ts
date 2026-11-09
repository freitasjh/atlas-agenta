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
  /** Operadores internos pré-existentes (user_ids). */
  operators?: string[];
  createUser?: () => { data: { user: { id: string } | null }; error: FakeAuthError };
  /** Erro do insert em `profiles` (legado `insertError` mantido como alias). */
  profileInsertError?: { code?: string } | null;
  insertError?: { code?: string } | null;
  /** Erro do insert em `internal_operators` (ex.: falha injetada no rollback). */
  operatorInsertError?: { code?: string } | null;
  /** Erro da leitura do freeze (`select limit` em `internal_operators`). */
  freezeError?: { code?: string } | null;
  listUsersError?: { status?: number } | null;
};

type FakeCalls = {
  createUser: unknown[];
  deleteUser: string[];
  insert: unknown[];
  /** Ordem das tabelas apagadas via `delete()` (ex.: `internal_operators` → `profiles`). */
  deletes: string[];
  operatorInserts: unknown[];
  listUsers: number;
};

type FakeStore = {
  profiles: Record<string, FakeProfile>;
  operators: Set<string>;
};

function fakeService(
  options: FakeOptions,
): { service: SupabaseClient; calls: FakeCalls; store: FakeStore } {
  const calls: FakeCalls = {
    createUser: [],
    deleteUser: [],
    insert: [],
    deletes: [],
    operatorInserts: [],
    listUsers: 0,
  };
  const store: FakeStore = {
    profiles: { ...(options.profiles ?? {}) },
    operators: new Set(options.operators ?? []),
  };

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
    from: (table: string) => {
      if (table === "internal_operators") {
        return {
          select: () => ({
            eq: (column: string, value: string) => ({
              maybeSingle: async () => {
                if (column === "user_id" && store.operators.has(value)) {
                  return { data: { user_id: value }, error: null };
                }
                return { data: null, error: null };
              },
            }),
            limit: async (n: number) => {
              if (options.freezeError) return { data: null, error: options.freezeError };
              return {
                data: [...store.operators].slice(0, n).map((user_id) => ({ user_id })),
                error: null,
              };
            },
          }),
          insert: async (row: unknown) => {
            calls.operatorInserts.push(row);
            if (options.operatorInsertError) {
              return { data: null, error: options.operatorInsertError };
            }
            const userId = (row as { user_id?: string }).user_id ?? "";
            if (store.operators.has(userId)) return { data: null, error: { code: "23505" } };
            store.operators.add(userId);
            return { data: null, error: null };
          },
          delete: () => ({
            eq: async (column: string, value: string) => {
              calls.deletes.push(table);
              if (column === "user_id") store.operators.delete(value);
              return { data: null, error: null };
            },
          }),
        };
      }
      return {
        select: () => ({
          eq: (_column: string, id: string) => ({
            maybeSingle: async () => ({ data: store.profiles[id] ?? null, error: null }),
          }),
          limit: async (_n: number) => ({ data: [], error: null }),
        }),
        insert: async (row: unknown) => {
          calls.insert.push(row);
          const failure = options.profileInsertError ?? options.insertError ?? null;
          if (failure) return { data: null, error: failure };
          const record = row as { id: string; role: string | null; tenant_id: string | null };
          store.profiles[record.id] = { role: record.role, tenant_id: record.tenant_id };
          return { data: null, error: null };
        },
        delete: () => ({
          eq: async (_column: string, id: string) => {
            calls.deletes.push(table);
            delete store.profiles[id];
            return { data: null, error: null };
          },
        }),
      };
    },
  };

  return { service: service as unknown as SupabaseClient, calls, store };
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
  return { handler, calls: fake.calls, store: fake.store, serviceCalls: () => serviceCalls };
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

Deno.test("criado inclui operador interno (count=1)", async () => {
  const { handler, calls, store } = build({ users: [] });
  const response = await call(handler);

  strictEqual(response.status, 201);
  deepStrictEqual(await response.json(), { status: "criado", user_id: "novo-id" });
  strictEqual(store.operators.size, 1);
  strictEqual(store.operators.has("novo-id"), true);
  deepStrictEqual(calls.deleteUser, []);
  deepStrictEqual(calls.deletes, []);
});

Deno.test("retry do mesmo user_id não duplica operador e não responde 500", async () => {
  // Retry real: a segunda chamada já encontra o usuário criado pela primeira (ja_existe) e o
  // insert do operador colide em 23505 → sucesso idempotente, sem 500 e sem duplicata.
  const { handler, store } = build({
    userSequence: [[], [{ id: "novo-id", email: SUPER_ADMIN_EMAIL }]],
  });

  const first = await call(handler);
  strictEqual(first.status, 201);
  deepStrictEqual(await first.json(), { status: "criado", user_id: "novo-id" });

  const second = await call(handler);
  strictEqual(second.status, 200);
  deepStrictEqual(await second.json(), { status: "ja_existe", user_id: "novo-id" });

  strictEqual(store.operators.size, 1);
});

Deno.test("duplo invoke paralelo em ja_existe: count=1 e zero 500", async () => {
  const { handler, store } = build({
    users: [{ id: "u-9", email: SUPER_ADMIN_EMAIL }],
    profiles: { "u-9": { role: "super_admin", tenant_id: null } },
    operators: [],
  });

  const [a, b] = await Promise.all([call(handler), call(handler)]);
  strictEqual(a.status, 200);
  strictEqual(b.status, 200);
  deepStrictEqual(await a.json(), { status: "ja_existe", user_id: "u-9" });
  deepStrictEqual(await b.json(), { status: "ja_existe", user_id: "u-9" });
  strictEqual(store.operators.size, 1);
});

Deno.test("falha no insert do operador desfaz operador→profile→usuário e responde 500", async () => {
  const { handler, calls, store } = build({
    users: [],
    operatorInsertError: { code: "XX000" },
  });
  const response = await call(handler);

  strictEqual(response.status, 500);
  const body = (await response.json()) as { code?: string };
  strictEqual(body.code, "internal_error");
  deepStrictEqual(calls.deletes, ["internal_operators", "profiles"]);
  deepStrictEqual(calls.deleteUser, ["novo-id"]);
  strictEqual("novo-id" in store.profiles, false);
  strictEqual(store.operators.size, 0);
});

Deno.test("com operadores existentes responde bootstrap_bloqueado e nada muda", async () => {
  const { handler, calls, store } = build({ users: [], operators: ["op-1"] });
  const response = await call(handler);

  strictEqual(response.status, 403);
  const body = (await response.json()) as { code?: string };
  strictEqual(body.code, "bootstrap_bloqueado");
  deepStrictEqual(calls.createUser, []);
  deepStrictEqual([...store.operators], ["op-1"]);
});

Deno.test("ja_existe cria operador faltante (cura pós-crash)", async () => {
  const { handler, store } = build({
    users: [{ id: "u-9", email: SUPER_ADMIN_EMAIL }],
    profiles: { "u-9": { role: "super_admin", tenant_id: null } },
    operators: [],
  });
  const response = await call(handler);

  strictEqual(response.status, 200);
  deepStrictEqual(await response.json(), { status: "ja_existe", user_id: "u-9" });
  strictEqual(store.operators.has("u-9"), true);
});

Deno.test("profile insert 42501 (freeze) responde bootstrap_bloqueado e remove usuário criado", async () => {
  const { handler, calls, store } = build({
    users: [],
    profileInsertError: { code: "42501" },
  });
  const response = await call(handler);

  strictEqual(response.status, 403);
  const body = (await response.json()) as { code?: string };
  strictEqual(body.code, "bootstrap_bloqueado");
  deepStrictEqual(calls.deleteUser, ["novo-id"]);
  strictEqual(store.operators.size, 0);
});

Deno.test("falha real de leitura dos operadores responde 500 sem criar nada", async () => {
  const { handler, calls } = build({ users: [], freezeError: { code: "XX000" } });
  const response = await call(handler);

  strictEqual(response.status, 500);
  const body = (await response.json()) as { code?: string };
  strictEqual(body.code, "internal_error");
  deepStrictEqual(calls.createUser, []);
});

Deno.test("tabela de operadores ausente (undefined_table) segue fluxo legado", async () => {
  const { handler, store } = build({ users: [], freezeError: { code: "42P01" } });
  const response = await call(handler);

  strictEqual(response.status, 201);
  deepStrictEqual(await response.json(), { status: "criado", user_id: "novo-id" });
  strictEqual(store.operators.has("novo-id"), true);
});

Deno.test("insert do operador sem tabela migrada segue legado (201)", async () => {
  const { handler, store } = build({
    users: [],
    freezeError: { code: "42P01" },
    operatorInsertError: { code: "42P01" },
  });
  // Simula legado total: sem tabela, o operador não persiste, mas o bootstrap passa.
  const response = await call(handler);

  strictEqual(response.status, 201);
  deepStrictEqual(await response.json(), { status: "criado", user_id: "novo-id" });
  strictEqual(store.operators.size, 0);
});

Deno.test("ja_existe com falha do operador responde 500 sem apagar identidade pré-existente", async () => {
  const { handler, calls, store } = build({
    users: [{ id: "u-9", email: SUPER_ADMIN_EMAIL }],
    profiles: { "u-9": { role: "super_admin", tenant_id: null } },
    operators: [],
    operatorInsertError: { code: "XX000" },
  });
  const response = await call(handler);

  strictEqual(response.status, 500);
  const body = (await response.json()) as { code?: string };
  strictEqual(body.code, "internal_error");
  deepStrictEqual(calls.deletes, []);
  deepStrictEqual(calls.deleteUser, []);
  deepStrictEqual(store.profiles["u-9"], { role: "super_admin", tenant_id: null });
  strictEqual(store.operators.size, 0);
});
