// Back-office T1.4/T1.5 (ADR-11; RF-32..35 + PRD §6.7/§7).
//
// Prova o contrato do ADR contra o stack local:
// - RPCs super-admin-only (não-super-admin → PT403) e `anon` sem EXECUTE;
// - `backoffice_subscriptions()` cross-tenant com inadimplência (contagem/valor);
// - `mrr_report` é SaaS (`kind=saas`) e `membership_mrr_churn` é membership
//   (`kind=membership`): métricas separadas, nunca somadas;
// - churn = canceladas no período e MRR exclui cancelada;
// - `nfce_volume` por status no período;
// - suspender/retomar pela Edge `admin-subscription` (caminho auditado): status do
//   tenant muda e a trilha grava autor + motivo; escrita direta pelo cliente é negada.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { anonClient, serviceClient } from "../helpers/clients.ts";
import { callFunction } from "../helpers/functions.ts";
import { ensureFunctionsDefault } from "../helpers/functions-server.ts";
import {
  createCommonUser,
  createSuperAdminUser,
  clearMustChangePassword,
  deleteTestUsers,
  tenantIdOf,
  type TestUser,
} from "../helpers/users.ts";
import { sql } from "../helpers/sql.ts";

let superAdmin: TestUser;
let ownerA: TestUser;
let ownerB: TestUser;
let tenantA: string;
let tenantB: string;
let planId: string;
let subscriptionId: string;

function count(query: string): number {
  return Number(sql(query));
}

async function rpcAs(
  user: TestUser,
  fn: string,
  args: Record<string, unknown> = {},
): Promise<{ data: unknown; code?: string; message?: string }> {
  const { data, error } = await user.client.rpc(fn, args);
  return { data, code: error?.code, message: error?.message };
}

async function statusOf(tenantId: string): Promise<string> {
  const { data, error } = await serviceClient()
    .from("tenants")
    .select("subscription_status")
    .eq("id", tenantId)
    .single();
  if (error || !data) throw new Error("Leitura do tenant falhou.");
  return data.subscription_status as string;
}

function auditRows(tenantId: string, motivo: string): number {
  return count(
    `select count(*) from public.subscription_status_changes where tenant_id = '${tenantId}' and reason = '${motivo}';`,
  );
}

/** Semeia a assinatura membership do tenant A com 1 cobrança vencida. */
async function seedMembership(): Promise<void> {
  const admin = serviceClient();
  const suffix = randomUUID().slice(0, 8);

  const customer = await admin
    .from("customers")
    .insert({
      tenant_id: tenantA,
      name: `Cliente Backoffice ${suffix}`,
      phone: "11987654321",
    })
    .select("id")
    .single();
  if (customer.error || !customer.data) {
    throw new Error(`Fixture customer falhou (código ${customer.error?.code ?? "vazio"}).`);
  }

  const plan = await admin
    .from("membership_plans")
    .insert({
      tenant_id: tenantA,
      name: `Mensal ${suffix}`,
      amount_cents: 9900,
      billing_period: "mensal",
      active: true,
    })
    .select("id")
    .single();
  if (plan.error || !plan.data) {
    throw new Error(`Fixture membership_plan falhou (código ${plan.error?.code ?? "vazio"}).`);
  }
  planId = plan.data.id as string;

  const subscription = await admin
    .from("membership_subscriptions")
    .insert({
      tenant_id: tenantA,
      customer_id: customer.data.id,
      plan_id: planId,
      status: "ativa",
      created_at: new Date(Date.now() - 60 * 24 * 3600 * 1000).toISOString(),
    })
    .select("id")
    .single();
  if (subscription.error || !subscription.data) {
    throw new Error(`Fixture membership_subscription falhou (código ${subscription.error?.code ?? "vazio"}).`);
  }
  subscriptionId = subscription.data.id as string;

  const charge = await admin.from("membership_charges").insert({
    tenant_id: tenantA,
    subscription_id: subscriptionId,
    cycle_ref: "2030-01",
    amount_cents: 9900,
    status: "vencido",
    due_at: new Date(Date.now() - 5 * 24 * 3600 * 1000).toISOString(),
  });
  if (charge.error) {
    throw new Error(`Fixture membership_charge falhou (código ${charge.error.code ?? "vazio"}).`);
  }
}

/** Semeia NFCe do tenant A no período corrente: 2 autorizadas, 1 contingência, 1 rejeitada. */
async function seedFiscal(): Promise<void> {
  const admin = serviceClient();
  const chave = () =>
    Array.from({ length: 44 }, () => Math.floor(Math.random() * 10)).join("");
  const rows = [
    { status: "autorizada", valor_cents: 10000, chave: chave() },
    { status: "autorizada", valor_cents: 20000, chave: chave() },
    { status: "contingencia", valor_cents: 5000, chave: null },
    { status: "rejeitada", valor_cents: 7000, chave: null },
  ];
  for (const row of rows) {
    const { error } = await admin.from("fiscal_documents").insert({
      tenant_id: tenantA,
      origem_tipo: "sale",
      origem_id: randomUUID(),
      numero: String(Math.floor(Math.random() * 100000)),
      serie: "1",
      chave_acesso: row.chave,
      status: row.status,
      valor_cents: row.valor_cents,
      xml: row.status === "autorizada" ? "<xml/>" : null,
      authorized_at: row.status === "autorizada" ? new Date().toISOString() : null,
    });
    if (error) {
      throw new Error(`Fixture fiscal_documents falhou (código ${error.code ?? "vazio"}).`);
    }
  }
}

const hoje = new Date().toISOString().slice(0, 10);
const ontem = new Date(Date.now() - 24 * 3600 * 1000).toISOString().slice(0, 10);

beforeAll(async () => {
  await ensureFunctionsDefault();
  superAdmin = await createSuperAdminUser("backoffice-super");
  await clearMustChangePassword(superAdmin.id);

  ownerA = await createCommonUser("backoffice-a");
  ownerB = await createCommonUser("backoffice-b");
  tenantA = await tenantIdOf(ownerA.id);
  tenantB = await tenantIdOf(ownerB.id);

  await seedMembership();
  await seedFiscal();
});

afterAll(async () => {
  await deleteTestUsers();
});

describe("ADR-11 back-office T1.4/T1.5", () => {
  it("RPCs são super-admin-only: admin de tenant recebe PT403", async () => {
    for (const [fn, args] of [
      ["backoffice_subscriptions", {}],
      ["mrr_report", {}],
      ["membership_mrr_churn", { p_from: ontem, p_to: hoje }],
      ["nfce_volume", { p_from: ontem, p_to: hoje }],
    ] as const) {
      const denied = await rpcAs(ownerA, fn, args as Record<string, unknown>);
      expect(denied.code, `${fn} deveria negar admin`).toBe("PT403");
    }

    const anon = await anonClient().rpc("mrr_report");
    expect(anon.error?.code).toBe("42501");
  });

  it("super admin vê assinatura membership cross-tenant com inadimplência", async () => {
    const result = await rpcAs(superAdmin, "backoffice_subscriptions");
    expect(result.code).toBeUndefined();
    const rows = result.data as Array<Record<string, unknown>>;
    const linha = rows.find((row) => row.subscription_id === subscriptionId);
    expect(linha, "assinatura do tenant A deve aparecer").toBeDefined();
    expect(linha?.tenant_id).toBe(tenantA);
    expect(linha?.status).toBe("ativa");
    expect(linha?.overdue_charges).toBe(1);
    expect(Number(linha?.overdue_amount_cents)).toBe(9900);
  });

  it("MRR SaaS e MRR membership são métricas separadas (kind distinto)", async () => {
    const saas = await rpcAs(superAdmin, "mrr_report");
    expect(saas.code).toBeUndefined();
    expect((saas.data as Record<string, unknown>).kind).toBe("saas");
    expect((saas.data as Record<string, unknown>).as_of).toEqual(expect.any(String));

    const membership = await rpcAs(superAdmin, "membership_mrr_churn", {
      p_from: ontem,
      p_to: hoje,
    });
    expect(membership.code).toBeUndefined();
    const body = membership.data as Record<string, unknown>;
    expect(body.kind).toBe("membership");
    expect(Number(body.mrr_cents)).toBeGreaterThanOrEqual(9900);
    expect(body.mrr_cents).not.toBe((saas.data as Record<string, unknown>).mrr_cents);
  });

  it("churn conta canceladas no período e MRR deixa de contar a cancelada", async () => {
    const antes = await rpcAs(superAdmin, "membership_mrr_churn", {
      p_from: ontem,
      p_to: hoje,
    });
    const antesBody = antes.data as Record<string, unknown>;
    const churnAntes = Number(antesBody.canceladas_periodo);
    const mrrAntes = Number(antesBody.mrr_cents);

    const cancel = await rpcAs(ownerA, "membership_update_status", {
      p_subscription_id: subscriptionId,
      p_status: "cancelada",
      p_reason: "cliente pediu encerramento",
    });
    expect(cancel.code).toBeUndefined();

    const membership = await rpcAs(superAdmin, "membership_mrr_churn", {
      p_from: ontem,
      p_to: hoje,
    });
    const body = membership.data as Record<string, unknown>;
    expect(Number(body.canceladas_periodo)).toBe(churnAntes + 1);
    expect(Number(body.mrr_cents)).toBe(mrrAntes - 9900);
  });

  it("volume NFCe por status no período", async () => {
    const result = await rpcAs(superAdmin, "nfce_volume", { p_from: ontem, p_to: hoje });
    expect(result.code).toBeUndefined();
    const body = result.data as Record<string, unknown>;
    expect(body.kind).toBe("nfce");
    expect(Number(body.autorizadas)).toBeGreaterThanOrEqual(2);
    expect(Number(body.contingencia)).toBeGreaterThanOrEqual(1);
    expect(Number(body.rejeitadas)).toBeGreaterThanOrEqual(1);
    expect(Number(body.valor_autorizado_cents)).toBeGreaterThanOrEqual(30000);
  });

  it("suspender/retomar pela Edge audita autor e motivo; cliente não escreve direto", async () => {
    // Estado operável (trial → ativo) por fora do caminho sob teste.
    const prep = await serviceClient().rpc("admin_set_subscription_status", {
      p_tenant_id: tenantA,
      p_new_status: "ativo",
      p_changed_by: superAdmin.id,
      p_reason: "preparacao do teste",
    });
    expect(prep.error).toBeNull();

    const direto = await ownerA.client
      .from("tenants")
      .update({ subscription_status: "cancelado" })
      .eq("id", tenantA);
    expect(direto.error?.code).toBe("42501");

    // Suspensão sem motivo é recusada antes de qualquer escrita (ADR-11).
    const semMotivo = await callFunction("admin-subscription", {
      token: superAdmin.accessToken,
      body: { action: "set_status", tenantId: tenantA, status: "bloqueado" },
    });
    expect(semMotivo.status).toBe(400);
    expect(await statusOf(tenantA)).toBe("ativo");

    const suspender = await callFunction("admin-subscription", {
      token: superAdmin.accessToken,
      body: {
        action: "set_status",
        tenantId: tenantA,
        status: "bloqueado",
        reason: "inadimplencia confirmada pelo financeiro",
      },
    });
    expect(suspender.status, suspender.text).toBe(200);
    expect(await statusOf(tenantA)).toBe("bloqueado");
    expect(auditRows(tenantA, "inadimplencia confirmada pelo financeiro")).toBe(1);

    const retomar = await callFunction("admin-subscription", {
      token: superAdmin.accessToken,
      body: {
        action: "set_status",
        tenantId: tenantA,
        status: "ativo",
        reason: "pagamento confirmado",
      },
    });
    expect(retomar.status, retomar.text).toBe(200);
    expect(await statusOf(tenantA)).toBe("ativo");

    const trilha = await superAdmin.client
      .from("subscription_status_changes")
      .select("changed_by, new_status, reason")
      .eq("tenant_id", tenantA)
      .eq("reason", "pagamento confirmado");
    expect(trilha.error).toBeNull();
    expect(trilha.data?.[0]).toMatchObject({
      changed_by: superAdmin.id,
      new_status: "ativo",
      reason: "pagamento confirmado",
    });

    // Trilha é sensível: admin de outro tenant lê zero linhas (RLS).
    const alheia = await ownerB.client
      .from("subscription_status_changes")
      .select("id")
      .eq("tenant_id", tenantA);
    expect(alheia.error).toBeNull();
    expect(alheia.data).toEqual([]);

    // O admin do tenant B enxerga a própria trilha (vazia) mas nunca a alheia.
    const propria = await ownerB.client
      .from("subscription_status_changes")
      .select("id")
      .eq("tenant_id", tenantB);
    expect(propria.error).toBeNull();
    expect(propria.data).toEqual([]);
  });
});
