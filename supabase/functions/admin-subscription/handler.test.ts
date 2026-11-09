// Testes do handler da Edge Function `admin-subscription` (ADR-03 + ADR-06) com client fake.
// Rodar com: `deno test --allow-env supabase/functions/admin-subscription/`.
//
// Cobrem a ordem do bloqueio por flag de troca de senha sem banco:
//  - `app_metadata.must_change_password === true` → 403 `password_change_required` SEM ler
//    `tenants` e SEM chamar a RPC (nenhuma escrita, nenhuma revelação de empresa);
//  - `false`, ausente e string `"true"` seguem o caminho normal e gravam via RPC;
//  - papel diferente de super_admin → 403 sem tocar em `tenants`;
//  - a identidade lê `profiles` só com `tenant_id, role` — a coluna `must_change_password` não é
//    mais lida (ADR-06), e `user_metadata` nunca é consultado;
//  - falha ao criar o client (configuração ausente) → 500 antes de tocar no Auth.
// Nenhum teste imprime segredo, token de produção ou PII.
import { deepStrictEqual, strictEqual } from "node:assert/strict";
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import {
  createAdminSubscriptionHandler,
  type AdminSubscriptionHandlerOptions,
} from "./handler.ts";

const USER_ID = "u-teste-adr06";
const TOKEN = "jwt-de-teste";
const TENANT_ID = "11111111-1111-4111-8111-111111111111";

type FakeProfile = { tenant_id: string | null; role: string };
type FakeTenant = { subscription_status: string };
type FakeError = { status?: number; message?: string; code?: string } | null;

type FakeOptions = {
  /** Usuário devolvido por `getUser`. `null` = token sem usuário. */
  user?: { id: string; app_metadata?: unknown } | null;
  getUserError?: FakeError;
  profile?: FakeProfile | null;
  profileError?: FakeError;
  tenant?: FakeTenant | null;
  tenantError?: FakeError;
  rpc?: { data?: unknown; error?: FakeError };
  /** MIG-BE-02: operador ativo em `internal_operators` (default false). */
  isOperator?: boolean;
  /** MIG-BE-02: factors MFA verificados (default 0). */
  verifiedFactors?: number;
};

/** JWT mínimo com claim `aal` (lido server-side por `readJwtAal`). */
function jwtWithAal(aal: string): string {
  const b64 = (v: unknown) =>
    btoa(JSON.stringify(v)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `${b64({ alg: "none", typ: "JWT" })}.${b64({ aal, sub: USER_ID })}.sig`;
}

const OPERATOR_AAL2_TOKEN = jwtWithAal("aal2");
const OPERATOR_AAL1_TOKEN = jwtWithAal("aal1");

type FakeCalls = {
  getUser: string[];
  profileSelect: string[];
  tenantSelect: string[];
  rpc: Array<Record<string, unknown>>;
};

function fakeService(options: FakeOptions): { service: SupabaseClient; calls: FakeCalls } {
  const calls: FakeCalls = { getUser: [], profileSelect: [], tenantSelect: [], rpc: [] };
  const user = options.user === undefined
    ? { id: USER_ID, app_metadata: {} }
    : options.user;

  const service = {
    auth: {
      getUser: async (token: string) => {
        calls.getUser.push(token);
        if (options.getUserError) return { data: { user: null }, error: options.getUserError };
        return { data: { user }, error: null };
      },
      admin: {
        mfa: {
          listFactors: async (_args: { userId: string }) => ({
            data: Array.from({ length: options.verifiedFactors ?? 0 }, (_, i) => ({ id: `f-${i}`, status: "verified" })),
            error: null,
          }),
        },
      },
    },
    from: (table: string) => ({
      select: (columns: string) => {
        if (table === "profiles") calls.profileSelect.push(columns);
        if (table === "tenants") calls.tenantSelect.push(columns);
        return {
          eq: (_column: string, _value: string) => ({
            is: (_icol: string, _ival: unknown) => ({
              maybeSingle: async () => {
                if (table === "internal_operators") {
                  return options.isOperator
                    ? { data: { user_id: USER_ID }, error: null }
                    : { data: null, error: null };
                }
                return { data: null, error: null };
              },
            }),
            maybeSingle: async () => {
              if (table === "profiles") {
                return { data: options.profile ?? null, error: options.profileError ?? null };
              }
              if (table === "tenants") {
                return { data: options.tenant ?? null, error: options.tenantError ?? null };
              }
              if (table === "internal_operators") {
                return options.isOperator
                  ? { data: { user_id: USER_ID }, error: null }
                  : { data: null, error: null };
              }
              return { data: null, error: null };
            },
          }),
        };
      },
    }),
    rpc: async (name: string, params: Record<string, unknown>) => {
      calls.rpc.push({ name, ...params });
      return options.rpc ?? {
        data: [{ old_status: "trial", new_status: "ativo" }],
        error: null,
      };
    },
  };

  return { service: service as unknown as SupabaseClient, calls };
}

function build(options: FakeOptions = {}, overrides: { createServiceThrows?: boolean } = {}) {
  const fake = fakeService(options);
  const handler = createAdminSubscriptionHandler({
    createService: () => {
      if (overrides.createServiceThrows) {
        throw new Error("Configuração do servidor ausente (SUPABASE_URL/SERVICE_ROLE_KEY).");
      }
      return fake.service;
    },
  } satisfies AdminSubscriptionHandlerOptions);
  return { handler, calls: fake.calls };
}

function call(
  handler: (req: Request) => Promise<Response>,
  init: { method?: string; token?: string | null; body?: unknown } = {},
): Promise<Response> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const token = init.token === undefined ? TOKEN : init.token;
  if (token !== null) headers.Authorization = `Bearer ${token}`;
  const body = init.body === undefined
    ? { action: "set_status", tenantId: TENANT_ID, status: "ativo" }
    : init.body;
  const method = init.method ?? "POST";
  return handler(
    new Request("http://localhost/functions/v1/admin-subscription", {
      method,
      headers,
      body: method === "POST" ? JSON.stringify(body) : undefined,
    }),
  );
}

const SUPER_ADMIN: FakeProfile = { tenant_id: null, role: "super_admin" };
const TRIAL_TENANT: FakeTenant = { subscription_status: "trial" };

Deno.test("flag true booleana: 403 password_change_required sem ler tenants nem gravar", async () => {
  const { handler, calls } = build({
    user: { id: USER_ID, app_metadata: { must_change_password: true } },
    profile: SUPER_ADMIN,
    tenant: TRIAL_TENANT,
  });

  const response = await call(handler);

  strictEqual(response.status, 403);
  const body = (await response.json()) as {
    error?: string;
    code?: string;
    message?: string;
  };
  strictEqual(body.code, "password_change_required");
  strictEqual(body.error, "Troque sua senha antes de operar o painel.");
  strictEqual(body.message, body.error);

  // Bloqueado não toca no tenant alvo nem chama a RPC de escrita;
  // a nega é contabilizada em `internal_admin_denies_total` (BE-04).
  deepStrictEqual(calls.tenantSelect, []);
  strictEqual(calls.rpc.length, 1);
  deepStrictEqual(calls.rpc[0], { name: "internal_admin_deny" });
});

Deno.test("identidade lê profiles só com tenant_id e role (sem must_change_password)", async () => {
  const { handler, calls } = build({
    user: { id: USER_ID, app_metadata: { must_change_password: true } },
    profile: SUPER_ADMIN,
  });

  await call(handler);

  deepStrictEqual(calls.profileSelect, ["tenant_id, role"]);
  strictEqual(calls.profileSelect.some((cols) => cols.includes("must_change_password")), false);
});

Deno.test("flag false: segue e grava via RPC com changed_by do JWT", async () => {
  const { handler, calls } = build({
    user: { id: USER_ID, app_metadata: { must_change_password: false } },
    profile: SUPER_ADMIN,
    tenant: TRIAL_TENANT,
  });

  const response = await call(handler);

  strictEqual(response.status, 200);
  deepStrictEqual(await response.json(), {
    ok: true,
    tenant_id: TENANT_ID,
    old_status: "trial",
    new_status: "ativo",
  });
  strictEqual(calls.tenantSelect.length, 1);
  strictEqual(calls.rpc.length, 1);
  deepStrictEqual(calls.rpc[0], {
    name: "admin_set_subscription_status",
    p_tenant_id: TENANT_ID,
    p_new_status: "ativo",
    p_changed_by: USER_ID,
    p_reason: null,
  });
  strictEqual(calls.rpc.some((c) => c.name === "internal_admin_deny"), false);
});

Deno.test("flag ausente: segue e grava via RPC", async () => {
  const { handler, calls } = build({
    user: { id: USER_ID, app_metadata: {} },
    profile: SUPER_ADMIN,
    tenant: TRIAL_TENANT,
  });

  const response = await call(handler);

  strictEqual(response.status, 200);
  strictEqual(calls.rpc.length, 1);
});

Deno.test("flag string 'true' NÃO bloqueia: segue o caminho normal", async () => {
  const { handler, calls } = build({
    user: { id: USER_ID, app_metadata: { must_change_password: "true" } },
    profile: SUPER_ADMIN,
    tenant: TRIAL_TENANT,
  });

  const response = await call(handler);

  strictEqual(response.status, 200);
  strictEqual(calls.rpc.length, 1);
});

Deno.test("papel admin: 403 de permissão sem ler tenants nem gravar", async () => {
  const { handler, calls } = build({
    user: { id: USER_ID, app_metadata: { must_change_password: false } },
    profile: { tenant_id: TENANT_ID, role: "admin" },
    tenant: TRIAL_TENANT,
  });

  const response = await call(handler);

  strictEqual(response.status, 403);
  deepStrictEqual(await response.json(), {
    error: "Você não tem permissão para alterar o status de assinatura.",
  });
  deepStrictEqual(calls.tenantSelect, []);
  strictEqual(calls.rpc.length, 1);
  deepStrictEqual(calls.rpc[0], { name: "internal_admin_deny" });
});

Deno.test("papel admin com flag true: recusa é de permissão, não de senha", async () => {
  const { handler, calls } = build({
    user: { id: USER_ID, app_metadata: { must_change_password: true } },
    profile: { tenant_id: TENANT_ID, role: "professional" },
  });

  const response = await call(handler);

  strictEqual(response.status, 403);
  const body = (await response.json()) as { code?: string };
  strictEqual(body.code, undefined);
  strictEqual(calls.rpc.length, 1);
  deepStrictEqual(calls.rpc[0], { name: "internal_admin_deny" });
});

Deno.test("sem token: 401 e nada é lido no Auth", async () => {
  const { handler, calls } = build({ profile: SUPER_ADMIN });

  const response = await call(handler, { token: null });

  strictEqual(response.status, 401);
  deepStrictEqual(calls.getUser, []);
  deepStrictEqual(calls.tenantSelect, []);
  deepStrictEqual(calls.rpc, []);
});

Deno.test("token recusado pelo GoTrue: 401 sem tocar em tenants", async () => {
  const { handler, calls } = build({ getUserError: { status: 401, message: "invalid" } });

  const response = await call(handler);

  strictEqual(response.status, 401);
  deepStrictEqual(calls.tenantSelect, []);
  deepStrictEqual(calls.rpc, []);
});

Deno.test("profile ausente: 401 sem tocar em tenants", async () => {
  const { handler, calls } = build({ profile: null });

  const response = await call(handler);

  strictEqual(response.status, 401);
  deepStrictEqual(calls.tenantSelect, []);
  deepStrictEqual(calls.rpc, []);
});

Deno.test("createService lança (config ausente): 500 sem tocar no Auth nem escrever", async () => {
  const { handler, calls } = build(
    { user: { id: USER_ID, app_metadata: { must_change_password: false } }, profile: SUPER_ADMIN },
    { createServiceThrows: true },
  );

  const response = await call(handler);

  strictEqual(response.status, 500);
  deepStrictEqual(await response.json(), {
    error: "Erro de configuração do servidor.",
  });
  deepStrictEqual(calls.getUser, []);
  deepStrictEqual(calls.profileSelect, []);
  deepStrictEqual(calls.tenantSelect, []);
  deepStrictEqual(calls.rpc, []);
});

Deno.test("corpo inválido: 400 antes do gate, sem leitura de tenant", async () => {
  const { handler, calls } = build({
    user: { id: USER_ID, app_metadata: { must_change_password: true } },
    profile: SUPER_ADMIN,
  });

  const response = await call(handler, { body: { action: "set_status" } });

  strictEqual(response.status, 400);
  deepStrictEqual(calls.tenantSelect, []);
  deepStrictEqual(calls.rpc, []);
});

Deno.test("método diferente de POST: 405 sem criar client", async () => {
  let created = 0;
  const { service } = fakeService({});
  const handler = createAdminSubscriptionHandler({
    createService: () => {
      created += 1;
      return service;
    },
  });

  const response = await call(handler, { method: "GET" });

  strictEqual(response.status, 405);
  strictEqual(created, 0);
});

Deno.test("OPTIONS: 200 de preflight sem criar client", async () => {
  let created = 0;
  const { service } = fakeService({});
  const handler = createAdminSubscriptionHandler({
    createService: () => {
      created += 1;
      return service;
    },
  });

  const response = await call(handler, { method: "OPTIONS" });

  strictEqual(response.status, 200);
  strictEqual(created, 0);
});

// MIG-BE-02: caminho do operador interno (ignora profiles.role).
Deno.test("operador+AAL2 com role professional executa (ignora role)", async () => {
  const { handler, calls } = build({
    user: { id: USER_ID, app_metadata: {} },
    profile: { tenant_id: null, role: "professional" },
    tenant: TRIAL_TENANT,
    isOperator: true,
    verifiedFactors: 1,
  });

  const response = await call(handler, { token: OPERATOR_AAL2_TOKEN });

  strictEqual(response.status, 200);
  strictEqual(calls.rpc.length, 1);
  deepStrictEqual(calls.rpc[0], {
    name: "admin_set_subscription_status",
    p_tenant_id: TENANT_ID,
    p_new_status: "ativo",
    p_changed_by: USER_ID,
    p_reason: null,
  });
  strictEqual(calls.rpc.some((c) => c.name === "internal_admin_deny"), false);
});

Deno.test("operador sem AAL2 cai no legado e nega (professional -> 403)", async () => {
  const { handler, calls } = build({
    user: { id: USER_ID, app_metadata: {} },
    profile: { tenant_id: null, role: "professional" },
    tenant: TRIAL_TENANT,
    isOperator: true,
    verifiedFactors: 1,
  });

  const response = await call(handler, { token: OPERATOR_AAL1_TOKEN });

  strictEqual(response.status, 403);
  deepStrictEqual(calls.tenantSelect, []);
  strictEqual(calls.rpc.length, 1);
  deepStrictEqual(calls.rpc[0], { name: "internal_admin_deny" });
});

Deno.test("nao-operador com role professional nega sem ler tenant (403) e conta deny", async () => {
  const { handler, calls } = build({
    user: { id: USER_ID, app_metadata: {} },
    profile: { tenant_id: null, role: "professional" },
    tenant: TRIAL_TENANT,
    isOperator: false,
    verifiedFactors: 0,
  });

  const response = await call(handler, { token: OPERATOR_AAL2_TOKEN });

  strictEqual(response.status, 403);
  deepStrictEqual(calls.tenantSelect, []);
  strictEqual(calls.rpc.length, 1);
  deepStrictEqual(calls.rpc[0], { name: "internal_admin_deny" });
});

Deno.test("operador com must_change_password=true nega 403 e conta deny", async () => {
  const { handler, calls } = build({
    user: { id: USER_ID, app_metadata: { must_change_password: true } },
    profile: { tenant_id: null, role: "professional" },
    tenant: TRIAL_TENANT,
    isOperator: true,
    verifiedFactors: 1,
  });

  const response = await call(handler, { token: OPERATOR_AAL2_TOKEN });

  strictEqual(response.status, 403);
  const body = (await response.json()) as {
    error?: string;
    code?: string;
    message?: string;
  };
  strictEqual(body.code, "password_change_required");
  strictEqual(body.error, "Troque sua senha antes de operar o painel.");
  strictEqual(body.message, body.error);
  deepStrictEqual(calls.tenantSelect, []);
  strictEqual(calls.rpc.length, 1);
  deepStrictEqual(calls.rpc[0], { name: "internal_admin_deny" });
});
