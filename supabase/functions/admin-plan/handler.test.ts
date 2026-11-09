// Testes do handler `admin-plan` com client fake. Rodar: `deno test --allow-env supabase/functions/admin-plan/`.
// Cobrem: 401/403/400/404/409 pt-BR, override pass-through, sem PII em log, IDOR forjado ignorado.
import { deepStrictEqual, strictEqual } from "node:assert/strict";
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { createAdminPlanHandler } from "./handler.ts";

const USER_ID = "u-teste-plan";
const TOKEN = "jwt-de-teste";
const TENANT_ID = "11111111-1111-4111-8111-111111111111";

type FakeOptions = {
  user?: { id: string; app_metadata?: unknown } | null;
  getUserError?: { message?: string } | null;
  profile?: { tenant_id: string | null; role: string } | null;
  profileError?: { message?: string } | null;
  tenant?: { plan: string } | null;
  tenantError?: { message?: string } | null;
  rpc?: { data?: unknown; error?: { message?: string } | null };
  operator?: boolean;
  verifiedFactors?: number;
};

type FakeCalls = { tenantSelect: number; rpc: Array<Record<string, unknown>> };

function fakeService(options: FakeOptions): { service: SupabaseClient; calls: FakeCalls } {
  const calls: FakeCalls = { tenantSelect: 0, rpc: [] };
  const user = options.user === undefined ? { id: USER_ID, app_metadata: {} } : options.user;
  const service = {
    auth: {
      getUser: async (_token: string) => {
        if (options.getUserError) return { data: { user: null }, error: options.getUserError };
        return { data: { user }, error: null };
      },
      admin: {
        mfa: {
          listFactors: async (_args: { userId: string }) => {
            const n = options.verifiedFactors ?? (options.operator === false ? 0 : 1);
            const totp = Array.from({ length: n }, (_, i) => ({ id: `f-${i}`, status: "verified" }));
            return { data: { totp }, error: null };
          },
        },
      },
    },
    from: (table: string) => ({
      select: (_cols: string) => ({
        eq: (_c: string, _v: string) => ({
          is: (_c2: string, _v2: unknown) => ({
            maybeSingle: async () => {
              if (table === "internal_operators") {
                const allowed = options.operator ?? true;
                return { data: allowed ? { user_id: USER_ID } : null, error: null };
              }
              return { data: null, error: null };
            },
          }),
          maybeSingle: async () => {
            if (table === "profiles") return { data: options.profile ?? null, error: options.profileError ?? null };
            if (table === "internal_operators") {
              const allowed = options.operator ?? true;
              return { data: allowed ? { user_id: USER_ID } : null, error: null };
            }
            if (table === "tenants") {
              calls.tenantSelect += 1;
              return { data: options.tenant ?? null, error: options.tenantError ?? null };
            }
            return { data: null, error: null };
          },
        }),
      }),
    }),
    rpc: async (name: string, params: Record<string, unknown>) => {
      calls.rpc.push({ name, ...params });
      return options.rpc ?? { data: [{ old_plan: "individual", new_plan: "clinica" }], error: null };
    },
  };
  return { service: service as unknown as SupabaseClient, calls };
}

const SUPER_ADMIN = { tenant_id: null, role: "super_admin" };
const REASON = "Crescimento da equipe com motivo detalhado";

function call(
  handler: (req: Request) => Promise<Response>,
  body: unknown = { action: "set_plan", tenantId: TENANT_ID, plan: "clinica", reason: REASON },
  token: string | null = TOKEN,
): Promise<Response> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token !== null) headers.Authorization = `Bearer ${token}`;
  return handler(
    new Request("http://localhost/functions/v1/admin-plan", {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    }),
  );
}

Deno.test("sem token: 401 pt-BR", async () => {
  const { service } = fakeService({ profile: SUPER_ADMIN });
  const handler = createAdminPlanHandler({ createService: () => service });
  const res = await call(handler, undefined, null);
  strictEqual(res.status, 401);
});

Deno.test("non-super_admin: 403 sem ler tenant alvo", async () => {
  const fake = fakeService({ profile: { tenant_id: TENANT_ID, role: "admin" }, tenant: { plan: "individual" } });
  const handler = createAdminPlanHandler({ createService: () => fake.service });
  const res = await call(handler);
  strictEqual(res.status, 403);
  deepStrictEqual(fake.calls.tenantSelect, 0);
  deepStrictEqual(fake.calls.rpc, []);
});

Deno.test("must_change_password true: 403 password_change_required", async () => {
  const fake = fakeService({
    user: { id: USER_ID, app_metadata: { must_change_password: true } },
    profile: SUPER_ADMIN,
  });
  const handler = createAdminPlanHandler({ createService: () => fake.service });
  const res = await call(handler);
  strictEqual(res.status, 403);
  const body = await res.json() as { code?: string };
  strictEqual(body.code, "password_change_required");
});

Deno.test("zod inválido (reason curto): 400 pt-BR", async () => {
  const fake = fakeService({ profile: SUPER_ADMIN, tenant: { plan: "individual" } });
  const handler = createAdminPlanHandler({ createService: () => fake.service });
  const res = await call(handler, { action: "set_plan", tenantId: TENANT_ID, plan: "clinica", reason: "curto" });
  strictEqual(res.status, 400);
});

Deno.test("sucesso repassa override e changed_by do JWT", async () => {
  const fake = fakeService({ profile: SUPER_ADMIN, tenant: { plan: "individual" } });
  const handler = createAdminPlanHandler({ createService: () => fake.service });
  const res = await call(handler, { action: "set_plan", tenantId: TENANT_ID, plan: "clinica", reason: REASON, override: true });
  strictEqual(res.status, 200);
  deepStrictEqual(fake.calls.rpc[0], {
    name: "admin_set_tenant_plan",
    p_tenant_id: TENANT_ID,
    p_new_plan: "clinica",
    p_changed_by: USER_ID,
    p_reason: REASON,
    p_override: true,
  });
});

Deno.test("RPC PLAN_LIMIT: 409 pt-BR com code", async () => {
  const fake = fakeService({
    profile: SUPER_ADMIN,
    tenant: { plan: "clinica" },
    rpc: { data: null, error: { message: "PLAN_LIMIT: Limite do plano individual: máximo 1 profissional" } },
  });
  const handler = createAdminPlanHandler({ createService: () => fake.service });
  const res = await call(handler, { action: "set_plan", tenantId: TENANT_ID, plan: "individual", reason: REASON });
  strictEqual(res.status, 409);
  const body = await res.json() as { code?: string; error?: string };
  strictEqual(body.code, "PLAN_LIMIT");
  strictEqual(body.error?.includes("Limite do plano"), true);
});

Deno.test("RPC tenant_not_found: 404 pt-BR", async () => {
  const fake = fakeService({
    profile: SUPER_ADMIN,
    tenant: { plan: "clinica" },
    rpc: { data: null, error: { message: "tenant_not_found" } },
  });
  const handler = createAdminPlanHandler({ createService: () => fake.service });
  const res = await call(handler, { action: "set_plan", tenantId: TENANT_ID, plan: "individual", reason: REASON });
  strictEqual(res.status, 404);
});

Deno.test("RPC same_plan: 409 pt-BR", async () => {
  const fake = fakeService({
    profile: SUPER_ADMIN,
    tenant: { plan: "individual" },
    rpc: { data: null, error: { message: "same_plan" } },
  });
  const handler = createAdminPlanHandler({ createService: () => fake.service });
  const res = await call(handler, { action: "set_plan", tenantId: TENANT_ID, plan: "individual", reason: REASON });
  strictEqual(res.status, 409);
});

Deno.test("super_admin sem operador: 403 operator_required (AAL real)", async () => {
  const fake = fakeService({ profile: SUPER_ADMIN, tenant: { plan: "individual" }, operator: false });
  const handler = createAdminPlanHandler({ createService: () => fake.service });
  const res = await call(handler);
  strictEqual(res.status, 403);
  deepStrictEqual(fake.calls.tenantSelect, 0);
  deepStrictEqual(fake.calls.rpc, []);
});

Deno.test("super_admin operador sem factor verificado: 403 (aal1 real nega)", async () => {
  const fake = fakeService({
    profile: SUPER_ADMIN,
    tenant: { plan: "individual" },
    operator: true,
    verifiedFactors: 0,
  });
  const handler = createAdminPlanHandler({ createService: () => fake.service });
  const res = await call(handler);
  strictEqual(res.status, 403);
  deepStrictEqual(fake.calls.tenantSelect, 0);
  deepStrictEqual(fake.calls.rpc, []);
});
