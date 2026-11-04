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
  professional_id?: string | null;
  accepted_user_id?: string | null;
};

type FakeProfessional = { profile_id: string | null; tenant_id: string | null } | null;

type FakeError = { code?: string; message?: string } | null;

type FakeAuthUser = { id: string; email: string };

type FakeOptions = {
  invitation?: FakeInvitation | null;
  invitationError?: FakeError;
  /** Usuários devolvidos pelo listUsers fake (default: usuário existente com o e-mail do convite). */
  authUsers?: FakeAuthUser[];
  listUsers?: (params: { page: number; perPage: number }) => Promise<{ data?: { users?: FakeAuthUser[]; nextPage?: number | null }; error?: unknown }>;
  listUsersError?: { code?: string; message?: string } | null;
  createUser?: (payload: unknown) => Promise<{ data?: { user?: { id: string } }; error?: unknown }>;
  updateUserById?: (id: string, attrs: unknown) => Promise<{ data?: { user?: { id: string } }; error?: unknown }>;
  updateUserByIdError?: FakeError;
  /** Quando true, o fake admin não expõe updateUserById (simula runtime sem a função). */
  noUpdateUserById?: boolean;
  profileError?: FakeError;
  /** Profile existente devolvido pelo select de guard (default: null = sem profile). */
  existingProfile?: { tenant_id: string | null } | null;
  profileSelectError?: FakeError;
  updateError?: FakeError;
  auditError?: FakeError;
  professional?: FakeProfessional;
  professionalError?: FakeError;
  professionalLinkError?: FakeError;
  /** Linhas devolvidas pelo update de link (default: [{ id }]). [] simula no-op de 0 rows. */
  professionalUpdateResult?: Array<{ id: string }>;
};

type FakeCalls = {
  invitationSelect: number;
  profileSelect: number;
  profileUpsert: unknown[];
  invitationUpdate: unknown[];
  auditInsert: unknown[];
  listUsers: Array<{ page: number; perPage: number }>;
  createUser: unknown[];
  updateUserById: Array<{ id: string; attrs: unknown }>;
  professionalSelect: Array<{ col: string; val: string }>;
  professionalUpdate: unknown[];
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
  const calls: FakeCalls = { invitationSelect: 0, profileSelect: 0, profileUpsert: [], invitationUpdate: [], auditInsert: [], listUsers: [], createUser: [], updateUserById: [], professionalSelect: [], professionalUpdate: [] };

  const admin: Record<string, unknown> = {
    listUsers: async (params: { page: number; perPage: number }) => {
      calls.listUsers.push(params);
      if (options.listUsers) return options.listUsers(params);
      if (options.listUsersError) return { data: { users: [], nextPage: null }, error: options.listUsersError };
      const users = options.authUsers ?? [{ id: "user-1", email: INV.email }];
      return { data: { users, nextPage: null }, error: null };
    },
    createUser: async (payload: unknown) => {
      calls.createUser.push(payload);
      if (options.createUser) return options.createUser(payload);
      return { data: { user: { id: "user-new" } }, error: null };
    },
  };
  if (!options.noUpdateUserById) {
    admin.updateUserById = async (id: string, attrs: unknown) => {
      calls.updateUserById.push({ id, attrs });
      if (options.updateUserById) return options.updateUserById(id, attrs);
      if (options.updateUserByIdError) return { data: { user: undefined }, error: options.updateUserByIdError };
      return { data: { user: { id } }, error: null };
    };
  }

  const service = {
    auth: { admin },
    from: (table: string) => {
      if (table === "professionals") {
        return {
          select: (_cols: string) => ({
            eq: (col: string, val: string) => ({
              maybeSingle: async () => {
                calls.professionalSelect.push({ col, val });
                if (options.professionalError) return { data: null, error: options.professionalError };
                return { data: options.professional ?? null, error: null };
              },
            }),
          }),
          update: (row: unknown) => {
            const chain = {
              eq: (_col: string, _val: string) => chain,
              is: (_col: string, _val: unknown) => chain,
              select: async (_cols: string) => {
                calls.professionalUpdate.push(row);
                if (options.professionalLinkError) return { data: null, error: options.professionalLinkError };
                return {
                  data: options.professionalUpdateResult ?? [{ id: "prof-1" }],
                  error: null,
                };
              },
            };
            return chain;
          },
        };
      }
      return {
      select: (_cols: string) => ({
        eq: (_col: string, _val: string) => ({
          maybeSingle: async () => {
            if (table === "invitations") {
              calls.invitationSelect += 1;
              return { data: options.invitation === undefined ? INV : options.invitation, error: options.invitationError ?? null };
            }
            if (table === "profiles") {
              calls.profileSelect += 1;
              if (options.profileSelectError) return { data: null, error: options.profileSelectError };
              return { data: options.existingProfile ?? null, error: null };
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
    };
    },
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

Deno.test("convite já aceito -> 200 com role (idempotente)", async () => {
  const { handler } = build({ invitation: { ...INV, status: "accepted" } });
  const res = await call(handler);
  strictEqual(res.status, 200);
  const body = await res.json() as { ok: boolean; role: string };
  strictEqual(body.ok, true);
  strictEqual(body.role, INV.role);
});

Deno.test("falha ao resolver usuário -> 500", async () => {
  const { handler } = build({
    authUsers: [],
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
  const body = await res.json() as { ok: boolean; role: string };
  strictEqual(body.ok, true);
  strictEqual(body.role, INV.role);
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

Deno.test("usuario ja existe no Auth => resolve userId via listUsers sem createUser", async () => {
  const { handler, calls } = build({
    authUsers: [{ id: "user-existing", email: INV.email.toUpperCase() }],
  });
  const res = await call(handler, { token: "a".repeat(16), password: "senha1234" });
  strictEqual(res.status, 200);
  strictEqual((await res.json()).ok, true);
  strictEqual(calls.listUsers.length >= 1, true);
  strictEqual(calls.listUsers[0].perPage, 200);
  strictEqual(calls.createUser.length, 0);
  const upsert = calls.profileUpsert[0] as { row: Record<string, unknown> };
  strictEqual(upsert.row.id, "user-existing");
});

Deno.test("createUser com email_exists => resolve via listUsers (corrida)", async () => {
  let listCalls = 0;
  const { handler, calls } = build({
    listUsers: async () => {
      listCalls += 1;
      // Primeira chamada (lookup inicial): usuário ainda não visível.
      if (listCalls === 1) return { data: { users: [], nextPage: null }, error: null };
      return { data: { users: [{ id: "user-raced", email: INV.email }], nextPage: null }, error: null };
    },
    createUser: async () => ({ data: { user: undefined }, error: { code: "email_exists", message: "User already registered" } }),
  });
  const res = await call(handler, { token: "a".repeat(16), password: "senha1234" });
  strictEqual(res.status, 200);
  strictEqual((await res.json()).ok, true);
  strictEqual(listCalls, 2);
  const upsert = calls.profileUpsert[0] as { row: Record<string, unknown> };
  strictEqual(upsert.row.id, "user-raced");
});

Deno.test("usuario novo (listUsers vazio) => cria via createUser", async () => {
  const { handler, calls } = build({ authUsers: [] });
  const res = await call(handler, { token: "a".repeat(16), password: "senha1234" });
  strictEqual(res.status, 200);
  strictEqual((await res.json()).ok, true);
  strictEqual(calls.listUsers.length, 1);
  strictEqual(calls.createUser.length, 1);
  const upsert = calls.profileUpsert[0] as { row: Record<string, unknown> };
  strictEqual(upsert.row.id, "user-new");
});

Deno.test("tryLinkProfessional: link ok vincula e audita", async () => {
  const { handler, calls } = build({
    invitation: { ...INV, professional_id: "prof-1" },
    professional: { profile_id: null, tenant_id: INV.tenant_id },
  });
  const res = await call(handler, { token: "a".repeat(16), password: "senha1234" });
  strictEqual(res.status, 200);
  strictEqual((await res.json()).ok, true);
  strictEqual(calls.professionalSelect.length, 1);
  strictEqual(calls.professionalUpdate.length, 1);
  const link = calls.professionalUpdate[0] as Record<string, unknown>;
  strictEqual(link.profile_id, "user-1");
  const linked = calls.auditInsert.find(
    (a) => (a as Record<string, unknown>).action === "professional.linked",
  ) as Record<string, unknown> | undefined;
  strictEqual(!!linked, true);
});

Deno.test("tryLinkProfessional: ja vinculado => no-op sem update", async () => {
  const { handler, calls } = build({
    invitation: { ...INV, professional_id: "prof-1" },
    authUsers: [{ id: "user-1", email: INV.email }],
    professional: { profile_id: "user-1", tenant_id: INV.tenant_id },
  });
  const res = await call(handler, { token: "a".repeat(16), password: "senha1234" });
  strictEqual(res.status, 200);
  strictEqual((await res.json()).ok, true);
  strictEqual(calls.professionalSelect.length, 1);
  strictEqual(calls.professionalUpdate.length, 0);
});

Deno.test("tryLinkProfessional: tenant mismatch => no-op sem update", async () => {
  const { handler, calls } = build({
    invitation: { ...INV, professional_id: "prof-1" },
    professional: { profile_id: null, tenant_id: "00000000-0000-4000-8000-000000000000" },
  });
  const res = await call(handler, { token: "a".repeat(16), password: "senha1234" });
  strictEqual(res.status, 200);
  strictEqual((await res.json()).ok, true);
  strictEqual(calls.professionalSelect.length, 1);
  strictEqual(calls.professionalUpdate.length, 0);
});

Deno.test("usuario existente + password => updateUserById aplica senha", async () => {
  const { handler, calls } = build({
    authUsers: [{ id: "user-existing", email: INV.email }],
  });
  const res = await call(handler, { token: "a".repeat(16), password: "senha1234" });
  strictEqual(res.status, 200);
  strictEqual((await res.json()).ok, true);
  strictEqual(calls.createUser.length, 0);
  strictEqual(calls.updateUserById.length, 1);
  strictEqual(calls.updateUserById[0].id, "user-existing");
  deepStrictEqual(calls.updateUserById[0].attrs, { password: "senha1234", email_confirm: true });
});

Deno.test("usuario existente sem password => updateUserById NAO chamado", async () => {
  const { handler, calls } = build({
    authUsers: [{ id: "user-existing", email: INV.email }],
  });
  const res = await call(handler, { token: "a".repeat(16) });
  strictEqual(res.status, 200);
  strictEqual((await res.json()).ok, true);
  strictEqual(calls.createUser.length, 0);
  strictEqual(calls.updateUserById.length, 0);
});

Deno.test("usuario novo => createUser com password e sem updateUserById", async () => {
  const { handler, calls } = build({ authUsers: [] });
  const res = await call(handler, { token: "a".repeat(16), password: "senha1234" });
  strictEqual(res.status, 200);
  strictEqual((await res.json()).ok, true);
  strictEqual(calls.createUser.length, 1);
  deepStrictEqual(calls.createUser[0], { email: INV.email, password: "senha1234", email_confirm: true });
  strictEqual(calls.updateUserById.length, 0);
});

Deno.test("retry email_exists + password => updateUserById aplica senha", async () => {
  let listCalls = 0;
  const { handler, calls } = build({
    listUsers: async () => {
      listCalls += 1;
      if (listCalls === 1) return { data: { users: [], nextPage: null }, error: null };
      return { data: { users: [{ id: "user-raced", email: INV.email }], nextPage: null }, error: null };
    },
    createUser: async () => ({ data: { user: undefined }, error: { code: "email_exists", message: "User already registered" } }),
  });
  const res = await call(handler, { token: "a".repeat(16), password: "senha1234" });
  strictEqual(res.status, 200);
  strictEqual((await res.json()).ok, true);
  strictEqual(calls.updateUserById.length, 1);
  strictEqual(calls.updateUserById[0].id, "user-raced");
  deepStrictEqual(calls.updateUserById[0].attrs, { password: "senha1234", email_confirm: true });
});

Deno.test("updateUserById falha => 500 internal_error", async () => {
  const { handler, calls } = build({
    authUsers: [{ id: "user-existing", email: INV.email }],
    updateUserByIdError: { code: "db-fail", message: "boom" },
  });
  const res = await call(handler, { token: "a".repeat(16), password: "senha1234" });
  strictEqual(res.status, 500);
  strictEqual((await res.json()).code, "internal_error");
  strictEqual(calls.updateUserById.length, 1);
  strictEqual(calls.profileUpsert.length, 0);
});

Deno.test("profile existente em outro tenant => 409 tenant_conflict sem upsert", async () => {
  const { handler, calls } = build({
    existingProfile: { tenant_id: "00000000-0000-4000-8000-000000000000" },
  });
  const res = await call(handler, { token: "a".repeat(16), password: "senha1234" });
  strictEqual(res.status, 409);
  strictEqual((await res.json()).code, "tenant_conflict");
  strictEqual(calls.profileSelect, 1);
  strictEqual(calls.profileUpsert.length, 0);
  strictEqual(calls.invitationUpdate.length, 0);
});

Deno.test("profile existente no mesmo tenant => upsert normal", async () => {
  const { handler, calls } = build({
    existingProfile: { tenant_id: INV.tenant_id },
  });
  const res = await call(handler, { token: "a".repeat(16), password: "senha1234" });
  strictEqual(res.status, 200);
  strictEqual((await res.json()).ok, true);
  strictEqual(calls.profileSelect, 1);
  strictEqual(calls.profileUpsert.length, 1);
});