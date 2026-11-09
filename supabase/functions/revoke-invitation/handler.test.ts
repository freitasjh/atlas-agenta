import { deepStrictEqual, strictEqual } from "node:assert/strict";
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import {
  createRevokeInvitationHandler,
  type RevokeInvitationHandlerOptions,
} from "./handler.ts";

const TOKEN = "jwt-de-teste";
const USER_ID = "u-revogar";
const TENANT_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_TENANT = "99999999-9999-4999-8999-999999999999";
const INVITATION_ID = "33333333-3333-4333-8333-333333333333";

type FakeProfile = { tenant_id: string | null; role: string };
type FakeInvitation = { id: string; tenant_id: string | null; status: string };
type FakeError = { code?: string; message?: string } | null;

type FakeOptions = {
  user?: { id: string } | null;
  getUserError?: FakeError;
  profile?: FakeProfile | null;
  profileError?: FakeError;
  invitation?: FakeInvitation | null;
  invitationError?: FakeError;
  updateError?: FakeError;
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
  invitationSelect: number;
  invitationUpdate: unknown[];
  auditInsert: unknown[];
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
  const calls: FakeCalls = { getUser: [], profileSelect: [], invitationSelect: 0, invitationUpdate: [], auditInsert: [], denyRpc: [] };
  const user = options.user === undefined ? { id: USER_ID, app_metadata: options.appMetadata ?? {} } : options.user;

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
    rpc: async (name: string) => {
      calls.denyRpc.push(name);
      return { data: null, error: null };
    },
    from: (table: string) => ({
      select: (_cols: string) => {
        if (table === "profiles") calls.profileSelect.push(_cols);
        const internalOperatorsSingle = async () => ({
          data: options.isOperator ? { user_id: USER_ID } : null,
          error: null,
        });
        return {
          eq: (_col: string, _val: string) => {
            if (table === "invitations") {
              return {
                is: (_icol: string, _ival: unknown) => ({ maybeSingle: internalOperatorsSingle }),
                maybeSingle: async () => {
                  calls.invitationSelect += 1;
                  return { data: options.invitation === undefined ? { id: INVITATION_ID, tenant_id: TENANT_ID, status: "pending" } : options.invitation, error: options.invitationError ?? null };
                },
              };
            }
            return {
              is: (_icol: string, _ival: unknown) => ({ maybeSingle: internalOperatorsSingle }),
              maybeSingle: async () => {
                if (table === "internal_operators") return internalOperatorsSingle();
                if (table === "profiles") return { data: options.profile ?? null, error: options.profileError ?? null };
                return { data: null, error: null };
              },
            };
          },
        };
      },
      update: (row: unknown) => ({
        eq: async (_col: string, _val: string) => {
          if (table === "invitations") calls.invitationUpdate.push(row);
          return { error: options.updateError ?? null };
        },
      }),
      insert: (row: unknown) => {
        if (table === "audit_log") calls.auditInsert.push(row);
        return { error: options.auditError ?? null };
      },
    }),
  };

  return { service: service as unknown as SupabaseClient, calls };
}

function build(options: FakeOptions = {}, overrides: { createServiceThrows?: boolean } = {}) {
  const fake = fakeService(options);
  const handler = createRevokeInvitationHandler({
    createService: () => {
      if (overrides.createServiceThrows) throw new Error("config");
      return fake.service;
    },
  } satisfies RevokeInvitationHandlerOptions);
  return { handler, calls: fake.calls };
}

async function call(handler: (r: Request) => Promise<Response>, body: unknown = { invitation_id: INVITATION_ID }, token: string = TOKEN) {
  return handler(new Request("http://localhost/functions/v1/revoke-invitation", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  }));
}

const SUPER_ADMIN: FakeProfile = { tenant_id: null, role: "super_admin" };
const ADMIN: FakeProfile = { tenant_id: TENANT_ID, role: "admin" };
const PROFESSIONAL: FakeProfile = { tenant_id: TENANT_ID, role: "professional" };

Deno.test("método não-POST -> 405", async () => {
  const { handler } = build();
  const res = await handler(new Request("http://localhost/functions/v1/revoke-invitation", { method: "GET", headers: { Authorization: `Bearer ${TOKEN}` } }));
  strictEqual(res.status, 405);
});

Deno.test("sem token -> 401", async () => {
  const { handler } = build();
  const res = await handler(new Request("http://localhost/functions/v1/revoke-invitation", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ invitation_id: INVITATION_ID }) }));
  strictEqual(res.status, 401);
});

Deno.test("corpo inválido -> 400", async () => {
  const { handler } = build({ profile: SUPER_ADMIN });
  const res = await call(handler, {});
  strictEqual(res.status, 400);
});

Deno.test("convite não encontrado -> 404", async () => {
  const { handler } = build({ profile: SUPER_ADMIN, invitation: null });
  const res = await call(handler);
  strictEqual(res.status, 404);
});

Deno.test("profissional não pode revogar -> 403", async () => {
  const { handler } = build({ profile: PROFESSIONAL });
  const res = await call(handler);
  strictEqual(res.status, 403);
});

Deno.test("super_admin revogando convite de tenant -> 403", async () => {
  const { handler } = build({ profile: SUPER_ADMIN, invitation: { id: INVITATION_ID, tenant_id: TENANT_ID, status: "pending" } });
  const res = await call(handler);
  strictEqual(res.status, 403);
});

Deno.test("admin revogando convite de outro tenant -> 403", async () => {
  const { handler } = build({ profile: ADMIN, invitation: { id: INVITATION_ID, tenant_id: OTHER_TENANT, status: "pending" } });
  const res = await call(handler);
  strictEqual(res.status, 403);
});

Deno.test("createService lança -> 500", async () => {
  const { handler } = build({}, { createServiceThrows: true });
  const res = await call(handler);
  strictEqual(res.status, 500);
});

Deno.test("super_admin revoga convite super_admin com sucesso (metadata vazio)", async () => {
  const { handler, calls } = build({ profile: SUPER_ADMIN, invitation: { id: INVITATION_ID, tenant_id: null, status: "pending" } });
  const res = await call(handler);
  strictEqual(res.status, 200);
  strictEqual((await res.json()).ok, true);
  strictEqual(calls.invitationUpdate.length, 1);
  const update = calls.invitationUpdate[0] as Record<string, unknown>;
  strictEqual(update.status, "revoked");
  strictEqual(calls.auditInsert.length, 1);
  const audit = calls.auditInsert[0] as Record<string, unknown>;
  const metadata = audit.metadata as Record<string, unknown>;
  deepStrictEqual(metadata, {});
});

Deno.test("admin revoga convite do próprio tenant", async () => {
  const { handler, calls } = build({ profile: ADMIN, invitation: { id: INVITATION_ID, tenant_id: TENANT_ID, status: "pending" } });
  const res = await call(handler);
  strictEqual(res.status, 200);
  strictEqual(calls.invitationUpdate.length, 1);
});

Deno.test("revogar já revogado não duplica update/audit", async () => {
  const { handler, calls } = build({ profile: ADMIN, invitation: { id: INVITATION_ID, tenant_id: TENANT_ID, status: "revoked" } });
  const res = await call(handler);
  strictEqual(res.status, 200);
  strictEqual(calls.invitationUpdate.length, 0);
  strictEqual(calls.auditInsert.length, 0);
});
// MIG-BE-02: caminho do operador interno (ignora profiles.role).
Deno.test("operador+AAL2 revoga convite de tenant (ignora role)", async () => {
  const { handler, calls } = build({ profile: { tenant_id: null, role: "professional" }, isOperator: true, verifiedFactors: 1 });
  const res = await call(handler, { invitation_id: INVITATION_ID }, OPERATOR_AAL2_TOKEN);
  strictEqual(res.status, 200);
  strictEqual(calls.invitationUpdate.length, 1);
  strictEqual(calls.auditInsert.length, 1);
});

Deno.test("operador sem AAL2 cai no legado e nega (professional -> 403)", async () => {
  const { handler, calls } = build({ profile: { tenant_id: null, role: "professional" }, isOperator: true, verifiedFactors: 1 });
  const res = await call(handler, { invitation_id: INVITATION_ID }, OPERATOR_AAL1_TOKEN);
  strictEqual(res.status, 403);
  strictEqual(calls.invitationUpdate.length, 0);
});

Deno.test("nao-operador com role professional nega (403, sem escrita)", async () => {
  const { handler, calls } = build({ profile: { tenant_id: TENANT_ID, role: "professional" }, isOperator: false, verifiedFactors: 0 });
  const res = await call(handler, { invitation_id: INVITATION_ID }, OPERATOR_AAL2_TOKEN);
  strictEqual(res.status, 403);
  strictEqual(calls.invitationUpdate.length, 0);
});

Deno.test("operador com must_change_password=true nega 403 e conta deny", async () => {
  const { handler, calls } = build({
    profile: { tenant_id: null, role: "professional" },
    isOperator: true,
    verifiedFactors: 1,
    appMetadata: { must_change_password: true },
  });
  const res = await call(handler, { invitation_id: INVITATION_ID }, OPERATOR_AAL2_TOKEN);
  strictEqual(res.status, 403);
  strictEqual(calls.invitationUpdate.length, 0);
  deepStrictEqual(calls.denyRpc, ["internal_admin_deny"]);
});

Deno.test("operador revoga convite de outro tenant (cross-tenant permitido)", async () => {
  const { handler, calls } = build({
    profile: { tenant_id: TENANT_ID, role: "professional" },
    isOperator: true,
    verifiedFactors: 1,
    invitation: { id: INVITATION_ID, tenant_id: OTHER_TENANT, status: "pending" },
  });
  const res = await call(handler, { invitation_id: INVITATION_ID }, OPERATOR_AAL2_TOKEN);
  strictEqual(res.status, 200);
  strictEqual(calls.invitationUpdate.length, 1);
});
