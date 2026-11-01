// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";

import type { TenantListItem } from "@/types/domain";
import type { UsageOverview, UsageTenantRow } from "@/hooks/useAdminUsageMetrics";
import {
  computeUsageKpis,
  filterUsageTenantsByPlan,
  filterUsageTenantsByStatus,
  filterUsageTenantsByStatusAndPlan,
  isDateRangeValid,
  isValidDate,
  toTimestamp,
} from "@/hooks/useAdminUsageMetrics";

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

describe("computeUsageKpis", () => {
  it("normalizes null overview", () => {
    const kpis = computeUsageKpis(null);
    expect(kpis.totalAppointments).toBe(0);
    expect(kpis.noShowRate).toBe(0);
    expect(kpis.retentionRate).toBe(0);
  });

  it("reads overview values", () => {
    const overview: UsageOverview = {
      total_appointments: 10,
      no_show_rate: 20,
      confirmation_rate: 70,
      whatsapp_usage: 5,
      new_tenants: 2,
      retention: { active: 8, cancelled: 2, rate: 80 },
    };
    const kpis = computeUsageKpis(overview);
    expect(kpis.totalAppointments).toBe(10);
    expect(kpis.noShowRate).toBe(20);
    expect(kpis.confirmationRate).toBe(70);
    expect(kpis.whatsappUsage).toBe(5);
    expect(kpis.newTenants).toBe(2);
    expect(kpis.retentionRate).toBe(80);
    expect(kpis.retentionActive).toBe(8);
    expect(kpis.retentionCancelled).toBe(2);
  });
});

describe("filterUsageTenantsByPlan", () => {
  const rows: UsageTenantRow[] = [
    { tenant_id: "1", trade_name: "A", appointments: 1, no_show: 0, whatsapp: 1 },
    { tenant_id: "2", trade_name: "B", appointments: 2, no_show: 1, whatsapp: 0 },
  ];
  const tenants = [
    tenant({ id: "1", plan: "individual" }),
    tenant({ id: "2", plan: "pro" }),
  ];

  it("todos returns all", () => {
    expect(filterUsageTenantsByPlan(rows, tenants, "todos")).toHaveLength(2);
  });

  it("filters by plan", () => {
    const out = filterUsageTenantsByPlan(rows, tenants, "pro");
    expect(out).toHaveLength(1);
    expect(out[0].tenant_id).toBe("2");
  });

  it("filters by status", () => {
    const tenantsWithStatus = [
      tenant({ id: "1", subscription_status: "ativo" }),
      tenant({ id: "2", subscription_status: "cancelado" }),
    ];
    const out = filterUsageTenantsByStatus(rows, tenantsWithStatus, "cancelado");
    expect(out).toHaveLength(1);
    expect(out[0].tenant_id).toBe("2");
  });

  it("filters by status and plan", () => {
    const tenantsMixed = [
      tenant({ id: "1", plan: "individual", subscription_status: "ativo" }),
      tenant({ id: "2", plan: "pro", subscription_status: "cancelado" }),
    ];
    const out = filterUsageTenantsByStatusAndPlan(rows, tenantsMixed, "cancelado", "pro");
    expect(out).toHaveLength(1);
    expect(out[0].tenant_id).toBe("2");
  });
});

describe("toTimestamp", () => {
  it("parses valid date", () => {
    expect(toTimestamp("2025-01-02")).toBe("2025-01-02T00:00:00.000Z");
    expect(toTimestamp("2025-01-02", true)).toBe("2025-01-02T23:59:59.999Z");
  });

  it("does not throw on invalid date", () => {
    expect(() => toTimestamp("not-a-date")).not.toThrow();
    expect(toTimestamp("not-a-date")).toBeNull();
    expect(toTimestamp("2025-13-40")).toBeNull();
  });
});

describe("date range validation", () => {
  it("validates date strings", () => {
    expect(isValidDate("2025-01-02")).toBe(true);
    expect(isValidDate("nope")).toBe(false);
  });

  it("validates start <= end", () => {
    expect(isDateRangeValid("2025-01-01", "2025-01-02")).toBe(true);
    expect(isDateRangeValid("2025-01-02", "2025-01-01")).toBe(false);
    expect(isDateRangeValid("bad", "2025-01-01")).toBe(false);
  });
});
