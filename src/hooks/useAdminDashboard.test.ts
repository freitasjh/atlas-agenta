// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";

import type { TenantListItem } from "@/types/domain";
import {
  computeAdminKpis,
  filterAdminTenants,
  filterTenants,
  filterTenantsByStatusAndPlan,
} from "@/hooks/useAdminDashboard";

function tenant(partial: Partial<TenantListItem>): TenantListItem {
  return {
    id: partial.id ?? "id",
    trade_name: partial.trade_name ?? null,
    legal_name: partial.legal_name ?? "Legal",
    document: null,
    owner_email: "a@b.com",
    plan: partial.plan ?? "individual",
    subscription_status: partial.subscription_status ?? "trial",
    trial_ends_at: partial.trial_ends_at ?? null,
    timezone: "America/Sao_Paulo",
    created_at: partial.created_at ?? new Date().toISOString(),
  };
}

describe("useAdminDashboard filters", () => {
  const tenants = [
    tenant({ id: "1", plan: "individual", subscription_status: "trial" }),
    tenant({ id: "2", plan: "clinica", subscription_status: "ativo" }),
    tenant({ id: "3", plan: "pro", subscription_status: "bloqueado" }),
  ];

  it("filter by status", () => {
    const out = filterAdminTenants(tenants, { status: "trial", plan: "todos" });
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe("1");
  });

  it("filter by plan", () => {
    const out = filterTenantsByStatusAndPlan(tenants, "todos", "pro");
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe("3");
  });

  it("filter by status and plan combined", () => {
    const out = filterTenants(tenants, "ativo", "clinica");
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe("2");
  });

  it("todos returns all", () => {
    expect(filterAdminTenants(tenants, { status: "todos", plan: "todos" })).toHaveLength(3);
  });
});

describe("computeAdminKpis", () => {
  it("counts by status and blocked", () => {
    const tenants = [
      tenant({ id: "1", subscription_status: "trial", trial_ends_at: new Date(Date.now() + 2 * 86400000).toISOString() }),
      tenant({ id: "2", subscription_status: "bloqueado" }),
    ];
    const kpis = computeAdminKpis(tenants, [], null);
    expect(kpis.total).toBe(2);
    expect(kpis.blocked).toBe(1);
    expect(kpis.trialsExpiring7d).toBe(1);
    expect(kpis.disconnectedWhatsApp).toBe(0);
    expect(kpis.appointmentsThisMonth).toBeNull();
  });
});