import { deepStrictEqual, strictEqual } from "node:assert/strict";
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import {
  createAcceptInvitationHandler,
  type AcceptInvitationHandlerOptions,
} from "./handler.ts";

const TOKEN = "jwt-de-teste";

type FakeInvitation = {
  id: string;
  tenant_id: string | null;
  email: string;
  role: string;
  status: string;
  expires_at: string;
};

type FakeError = { code?: string; message?: string } | null;

type FakeOptions = {
  invitation?: FakeInvitation | null;
  invitationError?: FakeError;
  getUserByEmail?: (email: string) => Promise<{ data?: { user?: { id: string } }; error?: unknown }>;
  createUser?: (payload: unknown) => Promise<{ data?: { user?: { id: string } }; error?: unknown }>;
  profileError?: FakeError;
  updateError?: FakeError;
  auditError?: FakeError;
};

type FakeCalls = {
  invitationSelect: number;
  profileUpsert: unknown[];
  invitationUpdate: unknown[];
  auditInsert: unknown[];
  getUserByEmail: string[];
  createUser: unknown[];
};

const INV: FakeInvitation = {
  id: "inv-1",
  tenant_id: "11111111-1111-4111-8111-111111111111",
  email: "convidado@teste.com",
  role: "professional",
  status: "pending",
  expires_at: new Date(Date.now() + 86400000).toISOString(),
};

function fakeService(options: FakeOptions = {}): { service: SupabaseClient; calls: FakeCalls } {
  const calls: FakeCalls = { invitationSelect: 0, profileUpsert: [], invitationUpdate: [], auditInsert: [], getUserByEmail: [], createUser: [] };

  const admin = {
    getUserByEmail: async (email: string) => {
      calls.getUserByEmail.push(email);
      if (options.getUserByEmail) return options.getUserByEmail(email);
      return { data: { user: { id: "user-1" } }, error: null };
    },
    createUser: async (payload: unknown) => {
      calls.createUser.push(payload);
      if (options.createUser) return options.createUser(payload);
      return { data: { user: { id: "user-new" } }, error: null };
    },
  };

  const service = {
    auth: { admin },
    from: (table: string) => ({
      select: (_cols: string) => ({
        eq: (_col: string, _val: string) => ({
          maybeSingle: async () => {
            if (table === "invitations") {
              calls.invitationSelect += 1;
              return { data: options.invitation === undefined ? INV : options.invitation, error: options.invitationError ?? null };
            }
            return { data: null, error: null };
          },
        }),
      }),
      upsert: async (row: unknown, opts: unknown) => {
        if (table === "profiles") calls.profileUpsert.push({ row, opts });
        return { error: options.profileError ?? null };
      },
      update: (row: unknown) => ({
        eq: async (_col: string, _val: string) => {
          if (table === "invitations") calls.invitationUpdate.push(row);
          return { error: options.updateError ?? null };
        },
      }),
      insert: (row: unknown) => {
        if (table === "audit_log") calls.auditInsert.push(row);
        return { error: null };
      },
    }),
  };

  return { service: service as unknown as SupabaseClient, calls };
}

function build(options: FakeOptions = {}, overrides: { createServiceThrows?: boolean } = {}) {
  const fake = fakeService(options);
  const handler = createAcceptInvitationHandler({
    createService: () => {
      if (overrides.createServiceThrows) throw new Error("config");
      return fake.service;
    },
  } satisfies AcceptInvitationHandlerOptions);
  return { handler, calls: fake.calls };
}

async function call(handler: (r: Request) => Promise<Response>, body: unknown = { token: "a".repeat(16) }) {
  return handler(new Request("http://localhost/functions/v1/accept-invitation", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }));
}

Deno.test("método não-POST -> 405", async () => {
  const { handler } = build();
  const res = await handler(new Request("http://localhost/functions/v1/accept-invitation", { method: "GET" }));
  strictEqual(res.status, 405);
});

Deno.test("corpo inválido -> 400", async () => {
  const { handler } = build();
  const res = await call(handler, { token: "short" });
  strictEqual(res.status, 400);
});

Deno.test("token não encontrado -> 410 invalid_or_expired", async () => {
  const { handler } = build({ invitation: null });
  const res = await call(handler);
  strictEqual(res.status, 410);
  strictEqual((await res.json()).code, "invalid_or_expired");
});

Deno.test("convite revogado -> 410 revoked", async () => {
  const { handler } = build({ invitation: { ...INV, status: "revoked" } });
  const res = await call(handler);
  strictEqual(res.status, 410);
  strictEqual((await res.json()).code, "revoked");
});

Deno.test("convite expirado (status) -> 410 invalid_or_expired", async () => {
  const { handler } = build({ invitation: { ...INV, status: "expired" } });
  const res = await call(handler);
  strictEqual(res.status, 410);
  strictEqual((await res.json()).code, "invalid_or_expired");
});

Deno.test("convite expirado por data -> 410 e marca expired", async () => {
  const { handler, calls } = build({ invitation: { ...INV, expires_at: new Date(Date.now() - 1000).toISOString() } });
  const res = await call(handler);
  strictEqual(res.status, 410);
  strictEqual((await res.json()).code, "invalid_or_expired");
  strictEqual(calls.invitationUpdate.length, 1);
});

Deno.test("convite já aceito -> 200", async () => {
  const { handler } = build({ invitation: { ...INV, status: "accepted" } });
  const res = await call(handler);
  strictEqual(res.status, 200);
  strictEqual((await res.json()).ok, true);
});

Deno.test("falha ao resolver usuário -> 500", async () => {
  const { handler } = build({
    getUserByEmail: async () => ({ data: { user: undefined }, error: null }),
    createUser: async () => ({ data: { user: undefined }, error: { message: "fail" } }),
  });
  const res = await call(handler);
  strictEqual(res.status, 500);
});

Deno.test("falha no upsert do profile -> 500", async () => {
  const { handler } = build({ profileError: { code: "23505" } });
  const res = await call(handler);
  strictEqual(res.status, 500);
});

Deno.test("createService lança -> 500", async () => {
  const { handler } = build({}, { createServiceThrows: true });
  const res = await call(handler);
  strictEqual(res.status, 500);
});

Deno.test("sucesso cria/atualiza profile e audit sem email", async () => {
  const { handler, calls } = build();
  const res = await call(handler, { token: "a".repeat(16), password: "senha1234" });
  strictEqual(res.status, 200);
  strictEqual((await res.json()).ok, true);
  strictEqual(calls.profileUpsert.length, 1);
  const upsert = calls.profileUpsert[0] as { row: Record<string, unknown> };
  strictEqual(upsert.row.id, "user-1");
  strictEqual(upsert.row.tenant_id, INV.tenant_id);
  strictEqual(upsert.row.role, INV.role);
  strictEqual(calls.invitationUpdate.length, 1);
  const update = calls.invitationUpdate[0] as Record<string, unknown>;
  strictEqual(update.status, "accepted");
  strictEqual(calls.auditInsert.length, 1);
  const audit = calls.auditInsert[0] as Record<string, unknown>;
  const metadata = audit.metadata as Record<string, unknown>;
  strictEqual(metadata.role, INV.role);
  strictEqual(Object.prototype.hasOwnProperty.call(metadata, "email"), false);
});