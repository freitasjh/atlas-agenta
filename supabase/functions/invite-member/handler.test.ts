import { deepStrictEqual, strictEqual } from "node:assert/strict";
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import {
  createInviteMemberHandler,
  type InviteMemberHandlerOptions,
} from "./handler.ts";

const TOKEN = "jwt-de-teste";
const USER_ID = "u-convite";
const TENANT_ID = "11111111-1111-4111-8111-111111111111";
const INVITATION_ID = "22222222-2222-4222-8222-222222222222";

type FakeProfile = { tenant_id: string | null; role: string; active?: boolean };
type FakeError = { code?: string; message?: string } | null;

type FakeOptions = {
  user?: { id: string } | null;
  getUserError?: FakeError;
  profile?: FakeProfile | null;
  profileError?: FakeError;
  insertError?: FakeError;
  auditError?: FakeError;
  /** MIG-BE-02: operador ativo em `internal_operators` (default false). */
  isOperator?: boolean;
  /** MIG-BE-02: factors MFA verificados (default 0). */
  verifiedFactors?: number;
  /** MIG-BE-02: `app_metadata` do usuário (p/ must_change_password). */
  appMetadata?: Record<string, unknown>;
};

type FakeCalls = {
  getUser: string[];
  profileSelect: string[];
  invitationInsert: unknown[];
  auditInsert: unknown[];
  inviteEmail: unknown[];
  denyRpc: string[];
};

/** JWT mínimo com claim `aal` (lido server-side por `readJwtAal`). */
function jwtWithAal(aal: string): string {
  const b64 = (v: unknown) =>
    btoa(JSON.stringify(v)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `${b64({ alg: "none", typ: "JWT" })}.${b64({ aal, sub: USER_ID })}.sig`;
}

const OPERATOR_AAL2_TOKEN = jwtWithAal("aal2");
const OPERATOR_AAL1_TOKEN = jwtWithAal("aal1");

function fakeService(options: FakeOptions = {}): { service: SupabaseClient; calls: FakeCalls } {
  const calls: FakeCalls = { getUser: [], profileSelect: [], invitationInsert: [], auditInsert: [], inviteEmail: [], denyRpc: [] };
  const user = options.user === undefined ? { id: USER_ID, app_metadata: options.appMetadata ?? {} } : options.user;

  const service = {
    auth: {
      getUser: async (token: string) => {
        calls.getUser.push(token);
        if (options.getUserError) return { data: { user: null }, error: options.getUserError };
        return { data: { user }, error: null };
      },
      admin: {
        inviteUserByEmail: async (email: string, opts: unknown) => {
          calls.inviteEmail.push({ email, opts });
          return { data: {}, error: null };
        },
        mfa: {
          listFactors: async (_args: { userId: string }) => ({
            data: Array.from({ length: options.verifiedFactors ?? 0 }, (_, i) => ({ id: `f-${i}`, status: "verified" })),
            error: null,
          }),
        },
      },
    },
    rpc: async (name: string) => {
      calls.denyRpc.push(name);
      return { data: null, error: null };
    },
    from: (table: string) => ({
      select: (columns: string) => {
        if (table === "profiles") calls.profileSelect.push(columns);
        return {
          eq: (_column: string, _value: string) => ({
            is: (_column: string, _value: unknown) => ({
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
              return { data: null, error: null };
            },
          }),
        };
      },
      insert: (row: unknown) => {
        if (table === "invitations") {
          calls.invitationInsert.push(row);
          return {
            select: (_cols: string) => ({
              single: async () => ({ data: { id: INVITATION_ID }, error: options.insertError ?? null }),
            }),
          };
        }
        if (table === "audit_log") {
          calls.auditInsert.push(row);
          return { error: options.auditError ?? null };
        }
        return { error: null };
      },
    }),
  };

  return { service: service as unknown as SupabaseClient, calls };
}

function build(options: FakeOptions = {}, overrides: { createServiceThrows?: boolean } = {}) {
  const fake = fakeService(options);
  const handler = createInviteMemberHandler({
    createService: () => {
      if (overrides.createServiceThrows) throw new Error("config");
      return fake.service;
    },
  } satisfies InviteMemberHandlerOptions);
  return { handler, calls: fake.calls };
}

async function call(handler: (r: Request) => Promise<Response>, init: { method?: string; token?: string | null; body?: unknown } = {}) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const token = init.token === undefined ? TOKEN : init.token;
  if (token !== null) headers.Authorization = `Bearer ${token}`;
  const method = init.method ?? "POST";
  return handler(new Request("http://localhost/functions/v1/invite-member", {
    method,
    headers,
    body: method === "POST" ? JSON.stringify(init.body ?? { email: "novo@teste.com", role: "professional" }) : undefined,
  }));
}

const SUPER_ADMIN: FakeProfile = { tenant_id: null, role: "super_admin", active: true };
const ADMIN: FakeProfile = { tenant_id: TENANT_ID, role: "admin", active: true };
const PROFESSIONAL: FakeProfile = { tenant_id: TENANT_ID, role: "professional", active: true };

Deno.test("método não-POST -> 405", async () => {
  const { handler } = build();
  const res = await call(handler, { method: "GET" });
  strictEqual(res.status, 405);
});

Deno.test("sem token -> 401", async () => {
  const { handler } = build();
  const res = await call(handler, { token: null });
  strictEqual(res.status, 401);
});

Deno.test("getUser falha -> 401", async () => {
  const { handler } = build({ getUserError: { message: "bad" } });
  const res = await call(handler);
  strictEqual(res.status, 401);
});

Deno.test("corpo inválido -> 400", async () => {
  const { handler } = build({ profile: SUPER_ADMIN });
  const res = await call(handler, { body: { email: "x", role: "nope" } });
  strictEqual(res.status, 400);
});

Deno.test("profissional não pode convidar -> 403", async () => {
  const { handler } = build({ profile: PROFESSIONAL });
  const res = await call(handler);
  strictEqual(res.status, 403);
});

Deno.test("super_admin convidando role não super_admin -> 403", async () => {
  const { handler } = build({ profile: SUPER_ADMIN });
  const res = await call(handler, { body: { email: "novo@teste.com", role: "admin" } });
  strictEqual(res.status, 403);
});

Deno.test("admin convidando role fora do conjunto -> 403", async () => {
  const { handler } = build({ profile: ADMIN });
  const res = await call(handler, { body: { email: "novo@teste.com", role: "super_admin" } });
  strictEqual(res.status, 403);
});

Deno.test("createService lança -> 500", async () => {
  const { handler } = build({}, { createServiceThrows: true });
  const res = await call(handler);
  strictEqual(res.status, 500);
});

Deno.test("insert falha -> 500", async () => {
  const { handler } = build({ profile: SUPER_ADMIN, insertError: { code: "23505" } });
  const res = await call(handler, { body: { email: "novo@teste.com", role: "super_admin" } });
  strictEqual(res.status, 500);
});

Deno.test("super_admin convida super_admin com sucesso e audit sem email", async () => {
  const { handler, calls } = build({ profile: SUPER_ADMIN });
  const res = await call(handler, { body: { email: "novo@teste.com", role: "super_admin" } });
  strictEqual(res.status, 201);
  const body = await res.json() as { ok: boolean; invitation_id: string; expires_at: string };
  strictEqual(body.ok, true);
  strictEqual(body.invitation_id, INVITATION_ID);
  strictEqual(calls.invitationInsert.length, 1);
  const inserted = calls.invitationInsert[0] as Record<string, unknown>;
  strictEqual(inserted.tenant_id, null);
  strictEqual(inserted.role, "super_admin");
  strictEqual(inserted.email, "novo@teste.com");
  strictEqual(calls.auditInsert.length, 1);
  const audit = calls.auditInsert[0] as Record<string, unknown>;
  strictEqual(audit.tenant_id, null);
  const metadata = audit.metadata as Record<string, unknown>;
  strictEqual(metadata.role, "super_admin");
  strictEqual(Object.prototype.hasOwnProperty.call(metadata, "email"), false);
});

Deno.test("admin convida professional com sucesso", async () => {
  const { handler, calls } = build({ profile: ADMIN });
  const res = await call(handler, { body: { email: "prof@teste.com", role: "professional" } });
  strictEqual(res.status, 201);
  const inserted = calls.invitationInsert[0] as Record<string, unknown>;
  strictEqual(inserted.tenant_id, TENANT_ID);
  strictEqual(inserted.role, "professional");
  const audit = calls.auditInsert[0] as Record<string, unknown>;
  strictEqual(audit.tenant_id, TENANT_ID);
});
// MIG-BE-02: caminho do operador interno (ignora profiles.role, alvo no corpo).
Deno.test("operador+AAL2 convida professional de qualquer tenant (ignora role)", async () => {
  const { handler, calls } = build({ profile: PROFESSIONAL, isOperator: true, verifiedFactors: 1 });
  const res = await call(handler, {
    token: OPERATOR_AAL2_TOKEN,
    body: { email: "prof@teste.com", role: "professional", tenant_id: TENANT_ID },
  });
  strictEqual(res.status, 201);
  const inserted = calls.invitationInsert[0] as Record<string, unknown>;
  strictEqual(inserted.tenant_id, TENANT_ID);
  strictEqual(inserted.role, "professional");
  const audit = calls.auditInsert[0] as Record<string, unknown>;
  strictEqual(audit.tenant_id, TENANT_ID);
});

Deno.test("operador sem AAL2 cai no legado e nega (professional -> 403)", async () => {
  const { handler, calls } = build({ profile: PROFESSIONAL, isOperator: true, verifiedFactors: 1 });
  const res = await call(handler, {
    token: OPERATOR_AAL1_TOKEN,
    body: { email: "prof@teste.com", role: "professional", tenant_id: TENANT_ID },
  });
  strictEqual(res.status, 403);
  strictEqual(calls.invitationInsert.length, 0);
});

Deno.test("nao-operador com role professional nega (403, sem escrita)", async () => {
  const { handler, calls } = build({ profile: PROFESSIONAL, isOperator: false, verifiedFactors: 0 });
  const res = await call(handler, {
    token: OPERATOR_AAL2_TOKEN,
    body: { email: "prof@teste.com", role: "professional", tenant_id: TENANT_ID },
  });
  strictEqual(res.status, 403);
  strictEqual(calls.invitationInsert.length, 0);
});

Deno.test("operador com must_change_password=true nega 403 e conta deny", async () => {
  const { handler, calls } = build({
    profile: PROFESSIONAL,
    isOperator: true,
    verifiedFactors: 1,
    appMetadata: { must_change_password: true },
  });
  const res = await call(handler, {
    token: OPERATOR_AAL2_TOKEN,
    body: { email: "prof@teste.com", role: "professional", tenant_id: TENANT_ID },
  });
  strictEqual(res.status, 403);
  strictEqual(calls.invitationInsert.length, 0);
  deepStrictEqual(calls.denyRpc, ["internal_admin_deny"]);
});

Deno.test("operador sem tenant_id no corpo -> 400 (alvo nunca implicito)", async () => {
  const { handler, calls } = build({ profile: PROFESSIONAL, isOperator: true, verifiedFactors: 1 });
  const res = await call(handler, {
    token: OPERATOR_AAL2_TOKEN,
    body: { email: "prof@teste.com", role: "professional" },
  });
  strictEqual(res.status, 400);
  strictEqual(calls.invitationInsert.length, 0);
});
