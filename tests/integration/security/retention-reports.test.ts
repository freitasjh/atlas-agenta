// RPCs de relatórios de retenção (ADR-09; RF-31..RF-33).
// Métricas corretas p/ fixtures conhecidas; filtros alteram resultado;
// só admin (recepção/profissional PT403); período inválido PT400;
// RLS: dados de outro tenant não vazam; coorte = mês da 1ª visita concluída,
// janelas 30/60/90 dias corridos após a 1ª visita.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { serviceClient } from "../helpers/clients.ts";
import { createPaymentsTenant, ensureUnlimitedPlan } from "../helpers/payments-fixtures.ts";
import type { PaymentsTenant } from "../helpers/payments-fixtures.ts";
import {
  createTenantMember,
  deleteTestUsers,
  type TestUser,
} from "../helpers/users.ts";

let tenant: PaymentsTenant;
let tenantB: PaymentsTenant;
let receptionist: TestUser;
let professional: TestUser;

const FROM = "2026-09-01T00:00:00.000Z";
const TO = "2026-10-01T00:00:00.000Z";

let svc1 = "";
let svc2 = "";
let prof1 = "";
let prof2 = "";

async function insertCatalog() {
  const admin = serviceClient();
  await ensureUnlimitedPlan(tenant.tenantId);
  const suffix = "ret9";
  const s1 = await admin.from("services").insert({
    tenant_id: tenant.tenantId, name: `Svc1 ${suffix}`, duration_minutes: 30, price_cents: 10_000,
  }).select("id").single();
  const s2 = await admin.from("services").insert({
    tenant_id: tenant.tenantId, name: `Svc2 ${suffix}`, duration_minutes: 30, price_cents: 5_000,
  }).select("id").single();
  const p1 = await admin.from("professionals").insert({
    tenant_id: tenant.tenantId, name: `Prof1 ${suffix}`,
  }).select("id").single();
  const p2 = await admin.from("professionals").insert({
    tenant_id: tenant.tenantId, name: `Prof2 ${suffix}`,
  }).select("id").single();
  if (s1.error || s2.error || p1.error || p2.error) throw new Error("Fixture catálogo falhou.");
  svc1 = s1.data.id as string;
  svc2 = s2.data.id as string;
  prof1 = p1.data.id as string;
  prof2 = p2.data.id as string;
  // Grade integral p/ prof1 e prof2: 08:00–12:00 todo dia (240 min/dia), sem break.
  for (const pid of [prof1, prof2]) {
    for (let wd = 0; wd <= 6; wd += 1) {
      const { error } = await admin.from("working_hours").insert({
        tenant_id: tenant.tenantId, professional_id: pid, weekday: wd,
        start_time: "08:00", end_time: "12:00",
      });
      if (error) throw new Error(`Fixture grade falhou (código ${error.code ?? "vazio"}).`);
    }
  }
}

async function mkCustomer(name: string): Promise<string> {
  const { data, error } = await serviceClient().from("customers").insert({
    tenant_id: tenant.tenantId, name, phone: "11987654321",
  }).select("id").single();
  if (error || !data) throw new Error("Fixture cliente falhou.");
  return data.id as string;
}

async function mkAppt(customerId: string, status: string, startsAt: string,
  priceCents: number, serviceId = svc1, professionalId = prof1): Promise<void> {
  const starts = new Date(startsAt);
  const ends = new Date(starts.getTime() + 30 * 60_000);
  const { error } = await serviceClient().from("appointments").insert({
    tenant_id: tenant.tenantId, customer_id: customerId, professional_id: professionalId,
    service_id: serviceId, starts_at: starts.toISOString(), ends_at: ends.toISOString(),
    price_cents: priceCents, status,
  });
  if (error) throw new Error(`Fixture appointment falhou (${error.code ?? "vazio"}).`);
}

beforeAll(async () => {
  tenant = await createPaymentsTenant("retention-reports");
  tenantB = await createPaymentsTenant("retention-reports-b");
  receptionist = await createTenantMember(tenant.tenantId, "receptionist", "retention-recep");
  professional = await createTenantMember(tenant.tenantId, "professional", "retention-prof");
  await insertCatalog();

  // cust1: 2 concluídos + 1 no-show + 1 confirmado + 1 cancelado (fora do denominador).
  const c1 = await mkCustomer("Coorte C1");
  await mkAppt(c1, "concluido", "2026-09-05T12:00:00.000Z", 10_000);
  await mkAppt(c1, "concluido", "2026-09-10T12:00:00.000Z", 20_000);
  await mkAppt(c1, "nao_compareceu", "2026-09-12T12:00:00.000Z", 10_000);
  await mkAppt(c1, "confirmado", "2026-09-15T12:00:00.000Z", 10_000, svc2);
  await mkAppt(c1, "cancelado", "2026-09-18T12:00:00.000Z", 10_000);
  // cust2/cust4: 1 concluído cada (coorte set, sem retorno em 30d).
  const c2 = await mkCustomer("Coorte C2");
  await mkAppt(c2, "concluido", "2026-09-06T12:00:00.000Z", 15_000);
  const c4 = await mkCustomer("Coorte C4");
  await mkAppt(c4, "concluido", "2026-09-05T14:00:00.000Z", 12_000);
  // cust3: 1ª visita em ago (coorte ago), retorno em set (retido em 60/90, não em 30).
  const c3 = await mkCustomer("Coorte C3");
  await mkAppt(c3, "concluido", "2026-08-04T12:00:00.000Z", 8_000);
  await mkAppt(c3, "concluido", "2026-09-10T14:00:00.000Z", 8_000);

  // Tenant B: 1 concluído — não pode vazar nas métricas do tenant A.
  const adminB = serviceClient();
  const sb = await adminB.from("services").insert({
    tenant_id: tenantB.tenantId, name: "Svc B", duration_minutes: 30, price_cents: 99_000,
  }).select("id").single();
  const pb = await adminB.from("professionals").insert({
    tenant_id: tenantB.tenantId, name: "Prof B",
  }).select("id").single();
  const cb = await adminB.from("customers").insert({
    tenant_id: tenantB.tenantId, name: "Cli B", phone: "11999999999",
  }).select("id").single();
  if (sb.error || pb.error || cb.error) throw new Error("Fixture tenant B falhou.");
  await adminB.from("appointments").insert({
    tenant_id: tenantB.tenantId, customer_id: cb.data.id, professional_id: pb.data.id,
    service_id: sb.data.id, starts_at: "2026-09-07T12:00:00.000Z",
    ends_at: "2026-09-07T12:30:00.000Z", price_cents: 99_000, status: "concluido",
  });
});

afterAll(async () => {
  const admin = serviceClient();
  for (const tid of [tenant.tenantId, tenantB.tenantId]) {
    for (const table of ["appointments", "working_hours", "service_professionals"] as const) {
      await admin.from(table).delete().eq("tenant_id", tid);
    }
    for (const table of ["customers", "professionals", "services"] as const) {
      await admin.from(table).delete().eq("tenant_id", tid);
    }
  }
  await deleteTestUsers();
});

describe("RBAC admin-only + período", () => {
  it("recepção e profissional recebem PT403 nas 6 RPCs", async () => {
    for (const user of [receptionist, professional]) {
      expect((await user.client.rpc("report_noshow_rate", { p_from: FROM, p_to: TO })).error?.code).toBe("PT403");
      expect((await user.client.rpc("report_rebooking_rate", { p_from: FROM, p_to: TO })).error?.code).toBe("PT403");
      expect((await user.client.rpc("report_utilization", { p_from: FROM, p_to: TO })).error?.code).toBe("PT403");
      expect((await user.client.rpc("report_ticket_medio", { p_from: FROM, p_to: TO })).error?.code).toBe("PT403");
      expect((await user.client.rpc("report_cohort_retention", { p_cohort_month: "2026-09-01" })).error?.code).toBe("PT403");
      expect((await user.client.rpc("report_retention_summary", { p_from: FROM, p_to: TO })).error?.code).toBe("PT403");
    }
  });

  it("período inválido recebe PT400", async () => {
    const { admin } = tenant;
    expect((await admin.client.rpc("report_noshow_rate", { p_from: FROM, p_to: FROM })).error?.code).toBe("PT400");
    expect((await admin.client.rpc("report_ticket_medio", {
      p_from: "2024-01-01T00:00:00.000Z", p_to: "2026-01-01T00:00:00.000Z",
    })).error?.code).toBe("PT400");
    expect((await admin.client.rpc("report_cohort_retention", { p_cohort_month: "2026-09-01", p_windows: [0] })).error?.code).toBe("PT400");
  });
});

describe("RF-33 métricas do admin", () => {
  it("no-show: 1 ÷ 7 = 0.1429; cancelado fora do denominador", async () => {
    const { data, error } = await tenant.admin.client.rpc("report_noshow_rate", { p_from: FROM, p_to: TO });
    expect(error).toBeNull();
    const r = data as Record<string, number>;
    expect(r.no_show_count).toBe(1);
    expect(r.denominator).toBe(7);
    expect(r.no_show_rate).toBeCloseTo(0.1429, 4);
  });

  it("filtro por serviço altera o no-show (svc2: só o confirmado)", async () => {
    const { data, error } = await tenant.admin.client.rpc("report_noshow_rate", {
      p_from: FROM, p_to: TO, p_service_id: svc2,
    });
    expect(error).toBeNull();
    const r = data as Record<string, number>;
    expect(r.denominator).toBe(1);
    expect(r.no_show_count).toBe(0);
    expect(r.no_show_rate).toBe(0);
  });

  it("rebooking: 1 recorrente ÷ 4 ativos = 0.25", async () => {
    const { data, error } = await tenant.admin.client.rpc("report_rebooking_rate", { p_from: FROM, p_to: TO });
    expect(error).toBeNull();
    const r = data as Record<string, number>;
    expect(r.active_customers).toBe(4);
    expect(r.repeat_customers).toBe(1);
    expect(r.rebooking_rate).toBe(0.25);
  });

  it("ticket médio: 65.000 ÷ 5 = 13.000 (sem vazar 99.000 do tenant B)", async () => {
    const { data, error } = await tenant.admin.client.rpc("report_ticket_medio", { p_from: FROM, p_to: TO });
    expect(error).toBeNull();
    const r = data as Record<string, number>;
    expect(r.completed_count).toBe(5);
    expect(r.total_cents).toBe(65_000);
    expect(r.average_ticket_cents).toBe(13_000);
  });

  it("utilização: 210 ocupados ÷ 14.400 grade = 0.0146; breakdown por profissional", async () => {
    const { data, error } = await tenant.admin.client.rpc("report_utilization", { p_from: FROM, p_to: TO });
    expect(error).toBeNull();
    const r = data as { occupied_minutes: number; available_minutes: number;
      utilization_rate: number; by_professional: Array<{ professional_id: string;
      occupied_minutes: number; available_minutes: number }> };
    // 7 slots de 30 min (cancelado fora); grade: 2 profs × 30 dias × 240 min.
    expect(r.occupied_minutes).toBe(210);
    expect(r.available_minutes).toBe(14_400);
    expect(r.utilization_rate).toBeCloseTo(0.0146, 4);
    expect(r.by_professional).toHaveLength(2);
    const p1 = r.by_professional.find((b) => b.professional_id === prof1);
    expect(p1?.occupied_minutes).toBe(210);
    const p2 = r.by_professional.find((b) => b.professional_id === prof2);
    expect(p2?.occupied_minutes).toBe(0);
  });

  it("filtro por profissional zera outro prof na utilização", async () => {
    const { data, error } = await tenant.admin.client.rpc("report_utilization", {
      p_from: FROM, p_to: TO, p_professional_id: prof2,
    });
    expect(error).toBeNull();
    const r = data as { occupied_minutes: number; available_minutes: number;
      by_professional: Array<{ professional_id: string }> };
    expect(r.occupied_minutes).toBe(0);
    expect(r.available_minutes).toBe(7_200);
    expect(r.by_professional).toHaveLength(1);
  });

  it("coorte set/2026: tamanho 3; retido 1 em 30/60/90", async () => {
    const { data, error } = await tenant.admin.client.rpc("report_cohort_retention", {
      p_cohort_month: "2026-09-15",
    });
    expect(error).toBeNull();
    const r = data as { cohort_month: string; cohort_size: number;
      windows: Array<{ window_days: number; retained_customers: number; retention_rate: number }> };
    expect(r.cohort_month).toBe("2026-09");
    expect(r.cohort_size).toBe(3);
    const w30 = r.windows.find((w) => w.window_days === 30);
    expect(w30).toMatchObject({ retained_customers: 1, retention_rate: 0.3333 });
  });

  it("coorte ago/2026: tamanho 1; fora em 30d, retido em 60/90d", async () => {
    const { data, error } = await tenant.admin.client.rpc("report_cohort_retention", {
      p_cohort_month: "2026-08-01", p_windows: [30, 60, 90],
    });
    expect(error).toBeNull();
    const r = data as { cohort_size: number;
      windows: Array<{ window_days: number; retained_customers: number; retention_rate: number }> };
    expect(r.cohort_size).toBe(1);
    expect(r.windows.find((w) => w.window_days === 30)).toMatchObject({ retained_customers: 0, retention_rate: 0 });
    expect(r.windows.find((w) => w.window_days === 60)).toMatchObject({ retained_customers: 1, retention_rate: 1 });
    expect(r.windows.find((w) => w.window_days === 90)).toMatchObject({ retained_customers: 1, retention_rate: 1 });
  });

  it("summary agrega as 4 métricas do hub", async () => {
    const { data, error } = await tenant.admin.client.rpc("report_retention_summary", { p_from: FROM, p_to: TO });
    expect(error).toBeNull();
    const r = data as Record<string, Record<string, number>>;
    expect(r.noshow.no_show_rate).toBeCloseTo(0.1429, 4);
    expect(r.rebooking.rebooking_rate).toBe(0.25);
    expect(r.utilization.occupied_minutes).toBe(210);
    expect(r.ticket.average_ticket_cents).toBe(13_000);
  });
});
