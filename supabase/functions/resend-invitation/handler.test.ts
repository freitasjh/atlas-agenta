import { deepStrictEqual, strictEqual } from "node:assert/strict";
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import {
  createResendInvitationHandler,
  type ResendInvitationHandlerOptions,
} from "./handler.ts";

const TOKEN = "jwt-de-teste";
const USER_ID = "u-reenviar";
const TENANT_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_TENANT = "99999999-9999-4999-8999-999999999999";
const INVITATION_ID = "44444444-4444-4444-8444-444444444444";

type FakeProfile = { tenant_id: string | null; role: string };
type FakeInvitation = { id: string; tenant_id: string | null; email: string; status: string };
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
};

type FakeCalls = {
  getUser: string[];
  profileSelect: string[];
  invitationSelect: number;
  invitationUpdate: unknown[];
  auditInsert: unknown[];
  inviteEmail: unknown[];
};

function fakeService(options: FakeOptions = {}): { service: SupabaseClient; calls: FakeCalls } {
  const calls: FakeCalls = { getUser: [], profileSelect: [], invitationSelect: 0, invitationUpdate: [], auditInsert: [], inviteEmail: [] };
  const user = options.user === undefined ? { id: USER_ID } : options.user;

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
      },
    },
    from: (table: string) => ({
      select: (_cols: string) => {
        if (table === "profiles") calls.profileSelect.push(_cols);
        return {
          eq: (_col: string, _val: string) => ({
            maybeSingle: async () => {
              if (table === "invitations") {
                calls.invitationSelect += 1;
                return { data: options.invitation === undefined ? { id: INVITATION_ID, tenant_id: TENANT_ID, email: "convidado@teste.com", status: "pending" } : options.invitation, error: options.invitationError ?? null };
              }
              return { data: options.profile ?? null, error: options.profileError ?? null };
            },
          }),
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
  const handler = createResendInvitationHandler({
    createService: () => {
      if (overrides.createServiceThrows) throw new Error("config");
      return fake.service;
    },
  } satisfies ResendInvitationHandlerOptions);
  return { handler, calls: fake.calls };
}

async function call(handler: (r: Request) => Promise<Response>, body: unknown = { invitation_id: INVITATION_ID }) {
  return handler(new Request("http://localhost/functions/v1/resend-invitation", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify(body),
  }));
}

const SUPER_ADMIN: FakeProfile = { tenant_id: null, role: "super_admin" };
const ADMIN: FakeProfile = { tenant_id: TENANT_ID, role: "admin" };
const PROFESSIONAL: FakeProfile = { tenant_id: TENANT_ID, role: "professional" };

Deno.test("método não-POST -> 405", async () => {
  const { handler } = build();
  const res = await handler(new Request("http://localhost/functions/v1/resend-invitation", { method: "GET", headers: { Authorization: `Bearer ${TOKEN}` } }));
  strictEqual(res.status, 405);
});

Deno.test("sem token -> 401", async () => {
  const { handler } = build();
  const res = await handler(new Request("http://localhost/functions/v1/resend-invitation", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ invitation_id: INVITATION_ID }) }));
  strictEqual(res.status, 401);
});

Deno.test("corpo inválido -> 400", async () => {
  const { handler } = build({ profile: ADMIN });
  const res = await call(handler, { invitation_id: "not-uuid" });
  strictEqual(res.status, 400);
});

Deno.test("convite não encontrado -> 404", async () => {
  const { handler } = build({ profile: ADMIN, invitation: null });
  const res = await call(handler);
  strictEqual(res.status, 404);
});

Deno.test("profissional não pode reenviar -> 403", async () => {
  const { handler } = build({ profile: PROFESSIONAL });
  const res = await call(handler);
  strictEqual(res.status, 403);
});

Deno.test("super_admin reenviando convite de tenant -> 403", async () => {
  const { handler } = build({ profile: SUPER_ADMIN, invitation: { id: INVITATION_ID, tenant_id: TENANT_ID, email: "x@teste.com", status: "pending" } });
  const res = await call(handler);
  strictEqual(res.status, 403);
});

Deno.test("admin reenviando convite de outro tenant -> 403", async () => {
  const { handler } = build({ profile: ADMIN, invitation: { id: INVITATION_ID, tenant_id: OTHER_TENANT, email: "x@teste.com", status: "pending" } });
  const res = await call(handler);
  strictEqual(res.status, 403);
});

Deno.test("createService lança -> 500", async () => {
  const { handler } = build({}, { createServiceThrows: true });
  const res = await call(handler);
  strictEqual(res.status, 500);
});

Deno.test("admin reenvia com sucesso: novo token_hash, expires_at, status pending, audit vazio", async () => {
  const { handler, calls } = build({ profile: ADMIN, invitation: { id: INVITATION_ID, tenant_id: TENANT_ID, email: "convidado@teste.com", status: "revoked" } });
  const res = await call(handler);
  strictEqual(res.status, 200);
  const body = await res.json() as { ok: boolean; expires_at: string };
  strictEqual(body.ok, true);
  strictEqual(typeof body.expires_at, "string");
  strictEqual(calls.invitationUpdate.length, 1);
  const update = calls.invitationUpdate[0] as Record<string, unknown>;
  strictEqual(typeof update.token_hash, "string");
  strictEqual(update.status, "pending");
  strictEqual(update.expires_at, body.expires_at);
  strictEqual(calls.auditInsert.length, 1);
  const audit = calls.auditInsert[0] as Record<string, unknown>;
  deepStrictEqual(audit.metadata, {});
});

Deno.test("super_admin reenvia convite super_admin", async () => {
  const { handler, calls } = build({ profile: SUPER_ADMIN, invitation: { id: INVITATION_ID, tenant_id: null, email: "super@teste.com", status: "pending" } });
  const res = await call(handler);
  strictEqual(res.status, 200);
  strictEqual(calls.invitationUpdate.length, 1);
});