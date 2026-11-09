// Guardas do operador interno (MIG-BE-01/BE-03/BE-04, internal-admin-migracao-telas).
// Nível catálogo (sem usuário): helper novo + grants, OR operador nas 11 RPCs
// 02b, RLS de tenant INTOCADA, auditoria append-only + métrica de negas.
// Roda na suíte de integração (`npm run test:integration`) contra o stack local.
import { describe, expect, it } from "vitest";
import { sql } from "../helpers/sql.ts";

/** `t` quando a query retorna 1 linha `t`, senão `f`/vazio. */
function isTrue(query: string): boolean {
  return sql(query) === "t";
}

describe("internal-admin operator guards (catálogo)", () => {
  it("BE-01: helper is_active_internal_operator existe, DEFINER, search_path fixo", () => {
    const def = sql(
      "select pg_get_functiondef('public.is_active_internal_operator()'::regprocedure);",
    );
    expect(def).toContain("SECURITY DEFINER");
    expect(def).toContain("search_path");
    expect(def).toContain("internal_operators");
  });

  it("BE-01: helper revogado p/ anon/public e liberado p/ authenticated", () => {
    expect(isTrue("select has_function_privilege('anon', 'public.is_active_internal_operator()', 'execute');")).toBe(false);
    expect(isTrue("select has_function_privilege('public', 'public.is_active_internal_operator()', 'execute');")).toBe(false);
    expect(isTrue("select has_function_privilege('authenticated', 'public.is_active_internal_operator()', 'execute');")).toBe(true);
  });

  it("BE-03: as 11 RPCs 02b contêm OR is_active_internal_operator no guard", () => {
    const fns = [
      "public.admin_dashboard_counts()",
      "public.admin_dashboard_disconnected_whatsapp()",
      "public.admin_usage_overview(timestamptz, timestamptz)",
      "public.admin_usage_series(timestamptz, timestamptz, text)",
      "public.admin_usage_tenants(timestamptz, timestamptz)",
      "public.admin_get_plan_mrr(text)",
      "public.admin_get_trial_conversion(date, date, text)",
      "public.admin_get_quota_utilization(numeric)",
      "public.admin_get_churn_por_plano(text)",
      "public.admin_get_plan_divergences()",
      "public.admin_get_tenant_plan(uuid)",
    ];
    for (const fn of fns) {
      const def = sql(`select pg_get_functiondef('${fn}'::regprocedure);`);
      expect(def).toContain("is_active_internal_operator");
    }
  });

  it("BE-03: writes seguem Edge-gated (sem EXECUTE p/ authenticated)", () => {
    expect(isTrue("select has_function_privilege('authenticated', 'public.admin_set_subscription_status(uuid, text, uuid, text)', 'execute');")).toBe(false);
    expect(isTrue("select has_function_privilege('authenticated', 'public.admin_set_tenant_plan(uuid, text, uuid, text, boolean)', 'execute');")).toBe(false);
  });

  it("RLS de tenant INTOCADA: policies conhecidas existem, nenhuma cita operador", () => {
    const superAdminSelect = sql(
      "select count(*) from pg_policies where schemaname = 'public' and tablename = 'tenants' and policyname = 'tenants_super_admin_select';",
    );
    expect(superAdminSelect).toBe("1");
    const operatorLeak = sql(
      "select count(*) from pg_policies where schemaname = 'public' and tablename in ('tenants','appointments','professionals','messages','charges','appointment_payments') and (qual::text ilike '%internal_operator%' or with_check::text ilike '%internal_operator%');",
    );
    expect(operatorLeak).toBe("0");
  });

  it("deny-all interno: internal_operators/audit com RLS e zero policies", () => {
    const tables = ["internal_operators", "internal_operator_audit", "internal_admin_denies_total"];
    for (const t of tables) {
      expect(sql(`select relrowsecurity::text from pg_class where relname = '${t}';`)).toBe("true");
    }
    expect(
      sql("select count(*) from pg_policies where schemaname = 'public' and tablename in ('internal_operators','internal_operator_audit','internal_admin_denies_total');"),
    ).toBe("0");
  });

  it("BE-04: auditoria append-only (trigger) + voided_at + métrica de negas", () => {
    expect(
      sql("select count(*) from pg_trigger where tgname = 'internal_operator_audit_append_only_trg';"),
    ).toBe("1");
    expect(
      sql("select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'internal_operator_audit' and column_name = 'voided_at';"),
    ).toBe("1");
    expect(
      sql("select denies from public.internal_admin_denies_total where id = 1;"),
    ).toMatch(/^\d+$/);
  });
});
