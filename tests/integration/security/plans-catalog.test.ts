// Catálogo SSoT de planos (T1.0 / G21 / G22 / G29).
//
// Cobra, contra o banco real (ladder T1.0b: free/starter/premium/enterprise):
//   - paridade tabela `plans` × functions `plan_price_cents` /
//     `plan_professional_limit` / `plan_appointment_limit`;
//   - RLS: anon/authenticated leem o catálogo, escrita negada;
//   - RPC `get_plans()` (caminho de leitura do frontend);
//   - TOCTOU (G29): advisory lock presente nas functions e o efeito prático —
//     duas inserções concorrentes não estouram a quota (sem mutar o catálogo:
//     o teste de agendamento usa `starter` com 149 vagas preenchidas em
//     lote e corre pela última vaga do mês);
//   - rename: slugs antigos migrados; free atribuível com quotas 1/30.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { anonClient, serviceClient } from "../helpers/clients.ts";
import {
  cleanupPaymentFixtures,
  createPaymentsTenant,
  type PaymentsTenant,
} from "../helpers/payments-fixtures.ts";
import { sql } from "../helpers/sql.ts";
import { createCommonUser, deleteTestUsers } from "../helpers/users.ts";

const tenantsToCleanup: string[] = [];

async function newTenant(prefix: string, plan: string): Promise<PaymentsTenant> {
  const tenant = await createPaymentsTenant(prefix);
  tenantsToCleanup.push(tenant.tenantId);
  const { error } = await serviceClient()
    .from("tenants")
    .update({ plan })
    .eq("id", tenant.tenantId);
  if (error) throw new Error(`Ajuste de plano falhou (código ${error.code ?? "vazio"}).`);
  return tenant;
}

function planRow(slug: string): {
  price_cents: number;
  prof_limit: number | null;
  appt_limit: number | null;
} {
  return JSON.parse(
    sql(
      `select json_build_object(
         'price_cents', public.plan_price_cents(:'slug'),
         'prof_limit', public.plan_professional_limit(:'slug'),
         'appt_limit', public.plan_appointment_limit(:'slug')
       );`,
      { slug },
    ),
  );
}

beforeAll(async () => {
  // Aquece o cliente anon usado nos casos de RLS.
  anonClient();
});

afterAll(async () => {
  await cleanupPaymentFixtures(tenantsToCleanup);
  await deleteTestUsers();
});

describe("T1.0 — paridade tabela × functions", () => {
  it("cada plano da tabela tem preço/quotas iguais às functions", async () => {
    const { data, error } = await serviceClient()
      .from("plans")
      .select("slug, price_cents, prof_limit, appt_limit")
      .order("sort_order");
    expect(error).toBeNull();
    expect(data).toHaveLength(4);

    for (const plan of data ?? []) {
      expect(planRow(plan.slug), `plano ${plan.slug}`).toEqual({
        price_cents: plan.price_cents,
        prof_limit: plan.prof_limit,
        appt_limit: plan.appt_limit,
      });
    }
  });

  it("seed traz free + starter + premium + enterprise com o rename aplicado", async () => {
    const { data, error } = await serviceClient()
      .from("plans")
      .select("slug, price_cents, prof_limit, appt_limit, active")
      .order("sort_order");
    expect(error).toBeNull();
    expect(data).toEqual([
      { slug: "free", price_cents: 0, prof_limit: 1, appt_limit: 30, active: true },
      { slug: "starter", price_cents: 5900, prof_limit: 1, appt_limit: 150, active: true },
      { slug: "premium", price_cents: 14900, prof_limit: 5, appt_limit: null, active: true },
      { slug: "enterprise", price_cents: 25900, prof_limit: null, appt_limit: null, active: true },
    ]);
  });

  it("slug desconhecido: preço 0 e limites null (contrato preservado)", () => {
    expect(planRow("diamond")).toEqual({
      price_cents: 0,
      prof_limit: null,
      appt_limit: null,
    });
  });
});

describe("T1.0 — RLS e RPC de leitura", () => {
  it("anon e authenticated leem o catálogo ativo", async () => {
    const anon = anonClient();
    const { data: anonData, error: anonErr } = await anon
      .from("plans")
      .select("slug")
      .order("sort_order");
    expect(anonErr).toBeNull();
    expect(anonData?.map((row) => row.slug)).toEqual([
      "free",
      "starter",
      "premium",
      "enterprise",
    ]);

    const user = await createCommonUser("plans-rls-read");
    const { data, error } = await user.client.from("plans").select("slug");
    expect(error).toBeNull();
    expect(data).toHaveLength(4);
  });

  it("get_plans() devolve os 4 ativos para anon e authenticated", async () => {
    const anon = anonClient();
    const { data: anonData, error: anonErr } = await anon.rpc("get_plans");
    expect(anonErr).toBeNull();
    expect((anonData as unknown[]).map((row) => (row as { slug: string }).slug)).toEqual([
      "free",
      "starter",
      "premium",
      "enterprise",
    ]);

    const user = await createCommonUser("plans-rls-rpc");
    const { data, error } = await user.client.rpc("get_plans");
    expect(error).toBeNull();
    expect((data as unknown[]).length).toBe(4);
  });

  it("cliente não escreve em plans (insert/update/delete negados)", async () => {
    const user = await createCommonUser("plans-rls-write");

    // Documenta a intenção do revoke/RLS: só SELECT é concedido a anon/authenticated.
    const privileges = JSON.parse(
      sql(
        `select json_build_object(
           'anon_insert', has_table_privilege('anon', 'public.plans', 'INSERT'),
           'auth_insert', has_table_privilege('authenticated', 'public.plans', 'INSERT'),
           'anon_update', has_table_privilege('anon', 'public.plans', 'UPDATE'),
           'auth_update', has_table_privilege('authenticated', 'public.plans', 'UPDATE'),
           'anon_delete', has_table_privilege('anon', 'public.plans', 'DELETE'),
           'auth_delete', has_table_privilege('authenticated', 'public.plans', 'DELETE'),
           'anon_select', has_table_privilege('anon', 'public.plans', 'SELECT'),
           'auth_select', has_table_privilege('authenticated', 'public.plans', 'SELECT')
         );`,
      ),
    );
    expect(privileges).toEqual({
      anon_insert: false,
      auth_insert: false,
      anon_update: false,
      auth_update: false,
      anon_delete: false,
      auth_delete: false,
      anon_select: true,
      auth_select: true,
    });

    const insert = await user.client
      .from("plans")
      .insert({ slug: "hack", name: "Hack", price_cents: 1 })
      .select("slug");
    expect(insert.error?.code).toBe("42501");

    const update = await user.client
      .from("plans")
      .update({ price_cents: 1 })
      .eq("slug", "starter")
      .select("slug");
    expect(update.error?.code).toBe("42501");

    const remove = await user.client.from("plans").delete().eq("slug", "free").select("slug");
    expect(remove.error?.code).toBe("42501");

    const { data } = await serviceClient().from("plans").select("slug").order("sort_order");
    expect(data?.map((row) => row.slug)).toEqual(["free", "starter", "premium", "enterprise"]);
  });
});

describe("G29 — advisory lock (TOCTOU)", () => {
  it("enforce_* e admin_set_tenant_plan usam pg_advisory_xact_lock", () => {
    for (const fn of [
      "enforce_professional_plan_limit",
      "enforce_appointment_plan_limit",
      "admin_set_tenant_plan",
    ]) {
      const def = sql(
        `select pg_get_functiondef(p.oid) from pg_proc p
           join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname = :'fn';`,
        { fn },
      );
      expect(def, fn).toContain("pg_advisory_xact_lock");
    }
  });

  it("duas inserções concorrentes de profissional: exatamente uma passa", async () => {
    const tenant = await newTenant("plans-conc-prof", "starter");
    for (let round = 0; round < 5; round += 1) {
      await serviceClient().from("professionals").delete().eq("tenant_id", tenant.tenantId);

      const [first, second] = await Promise.all([
        serviceClient()
          .from("professionals")
          .insert({ tenant_id: tenant.tenantId, name: `P ${randomUUID()}`, active: true })
          .select("id")
          .single(),
        serviceClient()
          .from("professionals")
          .insert({ tenant_id: tenant.tenantId, name: `P ${randomUUID()}`, active: true })
          .select("id")
          .single(),
      ]);

      const successes = [first, second].filter((result) => result.error === null);
      const failures = [first, second].filter((result) => result.error !== null);
      expect(successes.length, `rodada ${round}`).toBe(1);
      expect(failures.length, `rodada ${round}`).toBe(1);
      expect(failures[0]?.error?.code, `rodada ${round}`).toBe("23514");
      expect(failures[0]?.error?.message, `rodada ${round}`).toContain("PLAN_LIMIT");
    }
  });

  it("duas inserções concorrentes de agendamento: exatamente uma passa", async () => {
    // Sem mutar o catálogo global: usa `starter` (teto 150/mês, valor aceito
    // pelo CHECK de `tenants.plan`) e preenche 149 vagas em lote; a corrida é
    // pela última vaga do mês. Um plano dedicado exigiria um slug fora do
    // CHECK — o UPDATE de `tenants.plan` falharia com 23514.
    const tenant = await newTenant("plans-conc-appt", "starter");

    const service = await serviceClient()
      .from("services")
      .insert({ tenant_id: tenant.tenantId, name: `Serviço ${randomUUID()}`, duration_minutes: 30, price_cents: 0 })
      .select("id")
      .single();
    expect(service.error).toBeNull();
    const professional = await serviceClient()
      .from("professionals")
      .insert({ tenant_id: tenant.tenantId, name: `P ${randomUUID()}`, active: true })
      .select("id")
      .single();
    expect(professional.error).toBeNull();
    const customer = await serviceClient()
      .from("customers")
      .insert({ tenant_id: tenant.tenantId, name: "Cliente", phone: "11999999999" })
      .select("id")
      .single();
    expect(customer.error).toBeNull();

    // Slots de 30 min a partir do dia 2 do mês corrente no fuso do tenant
    // (America/Sao_Paulo, UTC-3 fixo): 149 sementes + 2 da corrida cabem no
    // mesmo mês e, adjacentes, não violam a exclusão de sobreposição.
    const SP_OFFSET_MS = 3 * 60 * 60 * 1000;
    const nowSp = new Date(Date.now() - SP_OFFSET_MS);
    const baseMs = Date.UTC(nowSp.getUTCFullYear(), nowSp.getUTCMonth(), 2, 12);
    const SLOT_MS = 30 * 60 * 1000;
    const SEEDED = 149;
    const row = (i: number) => {
      const starts = new Date(baseMs + i * SLOT_MS);
      return {
        tenant_id: tenant.tenantId,
        customer_id: customer.data?.id,
        professional_id: professional.data?.id,
        service_id: service.data?.id,
        starts_at: starts.toISOString(),
        ends_at: new Date(starts.getTime() + SLOT_MS).toISOString(),
        price_cents: 0,
        status: "confirmado",
      };
    };

    for (let round = 0; round < 5; round += 1) {
      await serviceClient().from("appointments").delete().eq("tenant_id", tenant.tenantId);

      const seed = await serviceClient()
        .from("appointments")
        .insert(Array.from({ length: SEEDED }, (_, i) => row(i)));
      expect(seed.error, `seed rodada ${round}`).toBeNull();

      const [first, second] = await Promise.all([
        serviceClient().from("appointments").insert(row(SEEDED)).select("id").single(),
        serviceClient().from("appointments").insert(row(SEEDED + 1)).select("id").single(),
      ]);

      const successes = [first, second].filter((result) => result.error === null);
      const failures = [first, second].filter((result) => result.error !== null);
      expect(successes.length, `rodada ${round}`).toBe(1);
      expect(failures.length, `rodada ${round}`).toBe(1);
      expect(failures[0]?.error?.code, `rodada ${round}`).toBe("23514");
      expect(failures[0]?.error?.message, `rodada ${round}`).toContain("PLAN_LIMIT");
    }
  });
});

describe("G29 — downgrade valida limites", () => {
  it("downgrade para starter com 2 profs ativos nega PLAN_LIMIT; override=true passa", async () => {
    const tenant = await newTenant("plans-downgrade", "enterprise");
    const { error: seedError } = await serviceClient()
      .from("professionals")
      .insert([
        { tenant_id: tenant.tenantId, name: `P1 ${randomUUID()}`, active: true },
        { tenant_id: tenant.tenantId, name: `P2 ${randomUUID()}`, active: true },
      ])
      .select("id");
    expect(seedError).toBeNull();

    const denied = await serviceClient().rpc("admin_set_tenant_plan", {
      p_tenant_id: tenant.tenantId,
      p_new_plan: "starter",
      p_changed_by: null,
      p_reason: "teste de downgrade",
      p_override: false,
    });
    expect(denied.error?.message).toContain("PLAN_LIMIT");

    const allowed = await serviceClient().rpc("admin_set_tenant_plan", {
      p_tenant_id: tenant.tenantId,
      p_new_plan: "starter",
      p_changed_by: null,
      p_reason: "teste de downgrade com override",
      p_override: true,
    });
    expect(allowed.error).toBeNull();

    const { data } = await serviceClient()
      .from("tenants")
      .select("plan")
      .eq("id", tenant.tenantId)
      .single();
    expect(data?.plan).toBe("starter");
  });

  it("free é atribuível: downgrade com 2 profs nega PLAN_LIMIT; override=true passa", async () => {
    const tenant = await newTenant("plans-downgrade-free", "enterprise");
    const { error: seedError } = await serviceClient()
      .from("professionals")
      .insert([
        { tenant_id: tenant.tenantId, name: `P1 ${randomUUID()}`, active: true },
        { tenant_id: tenant.tenantId, name: `P2 ${randomUUID()}`, active: true },
      ])
      .select("id");
    expect(seedError).toBeNull();

    const denied = await serviceClient().rpc("admin_set_tenant_plan", {
      p_tenant_id: tenant.tenantId,
      p_new_plan: "free",
      p_changed_by: null,
      p_reason: "teste de downgrade para free",
      p_override: false,
    });
    expect(denied.error?.message).toContain("PLAN_LIMIT");

    const allowed = await serviceClient().rpc("admin_set_tenant_plan", {
      p_tenant_id: tenant.tenantId,
      p_new_plan: "free",
      p_changed_by: null,
      p_reason: "teste de downgrade para free com override",
      p_override: true,
    });
    expect(allowed.error).toBeNull();

    // Quotas do free: 1 prof / 30 agend/mês (ladder T1.0b).
    expect(planRow("free")).toEqual({
      price_cents: 0,
      prof_limit: 1,
      appt_limit: 30,
    });
  });
});
