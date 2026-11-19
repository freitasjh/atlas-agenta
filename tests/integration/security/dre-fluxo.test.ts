// DRE + fluxo de caixa (ADR-09; RF-27..31 + PRD §6.6/§7).
//
// Prova o contrato do ADR: DRE competência (`starts_at`) vs caixa (`received_at`),
// avulsas em categoria própria, recorrência membership sem duplo-contar o ledger,
// gorjeta FORA de receita/margem/resultado, série mensal que soma o total, fluxo
// de 30 dias com saldo acumulado fechando no saldo final, `export_logs` com RLS
// admin-only, gating `dre_fluxo` e isolamento multi-tenant.
// Nada aqui escreve no ledger de atendimento.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { serviceClient } from "../helpers/clients.ts";
import {
  cleanupPaymentFixtures,
  createPaymentsTenant,
  ensureUnlimitedPlan,
  seedAppointment,
  type PaymentsTenant,
} from "../helpers/payments-fixtures.ts";
import { sql } from "../helpers/sql.ts";
import { createTenantMember, deleteTestUsers, type TestUser } from "../helpers/users.ts";

let tenantA: PaymentsTenant;
let tenantB: PaymentsTenant;
/** Tenant no plano inicial (starter), SEM o entitlement `dre_fluxo`. */
let tenantC: PaymentsTenant;
/** Tenant dedicado à borda de competência (ciclo do mês seguinte). */
let tenantD: PaymentsTenant;
let receptionist: TestUser;

/** Faixa do DRE de janeiro/2026 em instantes absolutos (meia-noite local BRT). */
const INI = "2026-01-01T03:00:00.000Z";
const FIM = "2026-02-01T03:00:00.000Z";

function count(query: string): number {
  return Number(sql(query));
}

async function rpcAs(
  user: TestUser,
  fn: string,
  args: Record<string, unknown>,
): Promise<{ data: unknown; code?: string; message?: string }> {
  const { data, error } = await user.client.rpc(fn, args);
  return { data, code: error?.code, message: error?.message };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function must(label: string, result: { data: unknown; error: { code?: string } | null }): any {
  if (result.error || result.data === null) {
    throw new Error(`Fixture ${label} falhou (código ${result.error?.code ?? "vazio"}).`);
  }
  return result.data;
}

async function seedCustomer(tenantId: string, name: string): Promise<string> {
  return must(
    "customer",
    await serviceClient()
      .from("customers")
      .insert({ tenant_id: tenantId, name, phone: "11987654321" })
      .select("id")
      .single(),
  ).id as string;
}

/** Cria atendimento com `starts_at` no alvo (o helper nasce com data futura). */
async function seedAtendimento(
  tenantId: string,
  startsAt: string,
  priceCents: number,
): Promise<string> {
  const appointment = await seedAppointment(tenantId, {
    priceCents,
    status: "concluido",
  });
  const starts = new Date(startsAt);
  const { error } = await serviceClient()
    .from("appointments")
    .update({
      starts_at: starts.toISOString(),
      ends_at: new Date(starts.getTime() + 30 * 60_000).toISOString(),
    })
    .eq("tenant_id", tenantId)
    .eq("id", appointment.appointmentId);
  if (error) throw new Error(`Ajuste de starts_at falhou (código ${error.code ?? "vazio"}).`);
  return appointment.appointmentId;
}

async function seedLedgerPayment(
  tenantId: string,
  appointmentId: string,
  amountCents: number,
  receivedAt: string,
  tipCents = 0,
): Promise<string> {
  return must(
    "appointment_payment",
    await serviceClient()
      .from("appointment_payments")
      .insert({
        tenant_id: tenantId,
        appointment_id: appointmentId,
        method: "dinheiro",
        amount_cents: amountCents,
        tip_cents: tipCents,
        source: "manual",
        received_at: receivedAt,
      })
      .select("id")
      .single(),
  ).id as string;
}

async function seedCommission(
  tenantId: string,
  appointmentId: string,
  baseCents: number,
  commissionCents: number,
  calculatedAt: string,
): Promise<void> {
  const { error } = await serviceClient().from("appointment_commissions").insert({
    tenant_id: tenantId,
    appointment_id: appointmentId,
    professional_id: (
      must(
        "appointment professional",
        await serviceClient()
          .from("appointments")
          .select("professional_id")
          .eq("tenant_id", tenantId)
          .eq("id", appointmentId)
          .single(),
      ) as { professional_id: string }
    ).professional_id,
    base_cents: baseCents,
    commission_pct: 10,
    commission_cents: commissionCents,
    calculated_at: calculatedAt,
  });
  if (error) throw new Error(`Fixture commission falhou (código ${error.code ?? "vazio"}).`);
}

async function seedAvulsa(
  tenantId: string,
  customerId: string,
  valorCents: number,
  vencimento: string,
  recebidoEm: string,
): Promise<string> {
  const receivableId = must(
    "receivable",
    await serviceClient()
      .from("receivables")
      .insert({
        tenant_id: tenantId,
        customer_id: customerId,
        descricao: "Avulsa de janeiro",
        categoria: "avulsa",
        vencimento_at: vencimento,
        valor_cents: valorCents,
        status: "pago",
      })
      .select("id")
      .single(),
  ).id as string;

  must(
    "receivable_settlement",
    await serviceClient()
      .from("receivable_settlements")
      .insert({
        tenant_id: tenantId,
        receivable_id: receivableId,
        valor_cents: valorCents,
        recebido_at: recebidoEm,
        metodo: "pix",
      })
      .select("id")
      .single(),
  );
  return receivableId;
}

async function seedPayable(
  tenantId: string,
  valorCents: number,
  vencimento: string,
  pagoEm: string,
  categoria = "aluguel",
): Promise<string> {
  const payableId = must(
    "payable",
    await serviceClient()
      .from("payables")
      .insert({
        tenant_id: tenantId,
        descricao: "Aluguel do salão",
        categoria,
        vencimento_at: vencimento,
        valor_cents: valorCents,
        status: "pago",
      })
      .select("id")
      .single(),
  ).id as string;

  must(
    "payable_settlement",
    await serviceClient()
      .from("payable_settlements")
      .insert({
        tenant_id: tenantId,
        payable_id: payableId,
        valor_cents: valorCents,
        pago_at: pagoEm,
        conta: "banco",
      })
      .select("id")
      .single(),
  );
  return payableId;
}

async function seedMembershipCharge(
  tenantId: string,
  customerId: string,
  amountCents: number,
  cycleRef: string,
  paidAt: string,
): Promise<void> {
  const planId = must(
    "membership_plan",
    await serviceClient()
      .from("membership_plans")
      .insert({
        tenant_id: tenantId,
        name: `Plano ${randomUUID().slice(0, 6)}`,
        amount_cents: amountCents,
        billing_period: "mensal",
      })
      .select("id")
      .single(),
  ).id as string;

  const subscriptionId = must(
    "membership_subscription",
    await serviceClient()
      .from("membership_subscriptions")
      .insert({ tenant_id: tenantId, customer_id: customerId, plan_id: planId, status: "ativa" })
      .select("id")
      .single(),
  ).id as string;

  must(
    "membership_charge",
    await serviceClient()
      .from("membership_charges")
      .insert({
        tenant_id: tenantId,
        subscription_id: subscriptionId,
        cycle_ref: cycleRef,
        amount_cents: amountCents,
        status: "pago",
        paid_at: paidAt,
      })
      .select("id")
      .single(),
  );
}

function groupValue(report: Record<string, unknown>, bloco: string, categoria: string): number {
  const grupos =
    ((report[bloco] as { grupos?: { categoria: string; valor_cents: number }[] })?.grupos ?? []);
  return grupos.find((grupo) => grupo.categoria === categoria)?.valor_cents ?? 0;
}

beforeAll(async () => {
  tenantA = await createPaymentsTenant("dre-a");
  tenantB = await createPaymentsTenant("dre-b");
  // `dre_fluxo` vive em premium/enterprise: A e B sobem para enterprise pela
  // RPC auditada. C fica no starter para o gate de entitlement.
  await ensureUnlimitedPlan(tenantA.tenantId);
  await ensureUnlimitedPlan(tenantB.tenantId);
  tenantC = await createPaymentsTenant("dre-c");
  receptionist = await createTenantMember(tenantA.tenantId, "receptionist", "dre-reception");

  const customerA = await seedCustomer(tenantA.tenantId, "Cliente DRE A");

  // 1) Atendimento de janeiro: recebido e concluído em janeiro (ambos regimes).
  const atendimentoJaneiro = await seedAtendimento(tenantA.tenantId, "2026-01-10T15:00:00.000Z", 20_000);
  await seedLedgerPayment(tenantA.tenantId, atendimentoJaneiro, 20_000, "2026-01-12T15:00:00.000Z", 3_000);
  await seedCommission(tenantA.tenantId, atendimentoJaneiro, 20_000, 2_000, "2026-01-10T16:00:00.000Z");

  // 2) Atendimento de competência janeiro mas CAIXA fevereiro: separa os regimes.
  const atendimentoFevereiro = await seedAtendimento(tenantA.tenantId, "2026-01-20T15:00:00.000Z", 10_000);
  await seedLedgerPayment(tenantA.tenantId, atendimentoFevereiro, 10_000, "2026-02-05T15:00:00.000Z");
  await seedCommission(tenantA.tenantId, atendimentoFevereiro, 10_000, 500, "2026-02-05T16:00:00.000Z");

  // 3) Avulsa recebida (categoria própria) — janeiro nos dois regimes.
  await seedAvulsa(
    tenantA.tenantId,
    customerA,
    7_000,
    "2026-01-15T12:00:00.000Z",
    "2026-01-16T12:00:00.000Z",
  );

  // 4) Despesa paga em janeiro.
  await seedPayable(
    tenantA.tenantId,
    4_000,
    "2026-01-25T12:00:00.000Z",
    "2026-01-26T12:00:00.000Z",
  );

  // 5) Recorrência (membership) paga no ciclo de janeiro.
  await seedMembershipCharge(tenantA.tenantId, customerA, 9_000, "2026-01", "2026-01-05T12:00:00.000Z");

  await seedBoundaryTenant();
});

/** Fixtures da borda de competência: ciclo do mês seguinte pago ainda em janeiro. */
async function seedBoundaryTenant(): Promise<void> {
  tenantD = await createPaymentsTenant("dre-d");
  await ensureUnlimitedPlan(tenantD.tenantId);
  const customerD = await seedCustomer(tenantD.tenantId, "Cliente DRE D");
  // Ciclo de janeiro pago em janeiro.
  await seedMembershipCharge(
    tenantD.tenantId,
    customerD,
    9_000,
    "2026-01",
    "2026-01-04T12:00:00.000Z",
  );
  // Ciclo de FEVEREIRO pago ainda em janeiro: entra no caixa de janeiro
  // (regime é a data do pagamento) e NUNCA na competência de janeiro.
  await seedMembershipCharge(
    tenantD.tenantId,
    customerD,
    12_345,
    "2026-02",
    "2026-01-20T12:00:00.000Z",
  );
}

afterAll(async () => {
  const admin = serviceClient();
  const tenants = [tenantA.tenantId, tenantB.tenantId, tenantC.tenantId, tenantD.tenantId];
  // Settlements são append-only: a limpeza do ambiente de teste desabilita os
  // triggers temporariamente (mesmo padrão de payables/conciliacao) e reabilita.
  sql("alter table public.payable_settlements disable trigger payable_settlements_no_update_delete;");
  sql("alter table public.receivable_settlements disable trigger receivable_settlements_no_update_delete;");
  try {
    for (const table of [
      "export_logs",
      "membership_charges",
      "membership_subscriptions",
      "membership_plans",
      "appointment_commissions",
      "payable_settlements",
      "receivable_settlements",
      "payables",
      "receivables",
    ] as const) {
      const { error } = await admin.from(table).delete().in("tenant_id", tenants);
      if (error) throw new Error(`Limpeza de ${table} falhou (código ${error.code ?? "sem código"}).`);
    }
  } finally {
    sql("alter table public.payable_settlements enable trigger payable_settlements_no_update_delete;");
    sql("alter table public.receivable_settlements enable trigger receivable_settlements_no_update_delete;");
  }
  await cleanupPaymentFixtures(tenants);
  await deleteTestUsers();
});

describe("schema, RLS e gating das RPCs de DRE", () => {
  it("export_logs existe com *_cents ausente, RLS on e uma policy admin de select", () => {
    expect(
      count(
        `select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'public' and c.relname = 'export_logs' and c.relkind = 'r';`,
      ),
    ).toBe(1);
    expect(
      count(
        `select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'public' and c.relname = 'export_logs' and c.relrowsecurity;`,
      ),
    ).toBe(1);
    expect(
      sql(
        `select string_agg(policyname || ':' || cmd, ',' order by policyname)
           from pg_policies where schemaname = 'public' and tablename = 'export_logs';`,
      ),
    ).toBe("export_logs_select_tenant_admin:SELECT");
    expect(
      sql(
        `select string_agg(column_name || ':' || data_type, ',' order by column_name)
           from information_schema.columns
          where table_schema = 'public' and table_name = 'export_logs'
            and column_name in ('arquivo_path','created_at','created_by','formato','periodo','tipo');`,
      ),
    ).toBe(
      "arquivo_path:text,created_at:timestamp with time zone,created_by:uuid,formato:text,periodo:text,tipo:text",
    );
  });

  it("receptionist é barrado nas RPCs de leitura (RBAC admin-only)", async () => {
    const dre = await rpcAs(receptionist, "dre_report", { p_ini: INI, p_fim: FIM, p_regime: "caixa" });
    expect(dre.code).toBe("PT403");
    expect(dre.message).toContain("FORBIDDEN");

    const fluxo = await rpcAs(receptionist, "cashflow_30d", { p_base: "2026-01-01" });
    expect(fluxo.code).toBe("PT403");
  });

  it("plano sem dre_fluxo recebe FEATURE_DISABLED e zero número", async () => {
    const { data, code, message } = await rpcAs(tenantC.admin, "dre_report", {
      p_ini: INI,
      p_fim: FIM,
      p_regime: "caixa",
    });
    expect(data).toBeNull();
    expect(code).toBe("PT403");
    expect(message).toContain("FEATURE_DISABLED");

    const fluxo = await rpcAs(tenantC.admin, "cashflow_30d", { p_base: "2026-01-01" });
    expect(fluxo.code).toBe("PT403");
  });
});

describe("dre_report — regimes, categorias e gorjeta", () => {
  it("caixa bate ledger + avulsas − comissões − pagos, com gorjeta fora", async () => {
    const { data, code } = await rpcAs(tenantA.admin, "dre_report", {
      p_ini: INI,
      p_fim: FIM,
      p_regime: "caixa",
    });
    expect(code).toBeUndefined();
    const report = data as Record<string, unknown>;

    expect(report.regime).toBe("caixa");
    expect((report.receitas as { total_cents: number }).total_cents).toBe(36_000);
    expect(groupValue(report, "receitas", "Atendimentos")).toBe(20_000);
    expect(groupValue(report, "receitas", "Receitas avulsas")).toBe(7_000);
    expect(groupValue(report, "receitas", "Recorrência")).toBe(9_000);
    expect((report.custos as { total_cents: number }).total_cents).toBe(2_000);
    expect(report.margem_cents).toBe(34_000);
    expect((report.despesas as { total_cents: number }).total_cents).toBe(4_000);
    expect(groupValue(report, "despesas", "aluguel")).toBe(4_000);
    expect(report.resultado_cents).toBe(30_000);
    // Gorjeta NUNCA entra: o valor existe, mas é devolvido à parte.
    expect(report.gorjeta_ignorada_cents).toBe(3_000);
  });

  it("competência usa starts_at: atendimento de janeiro recebido em fevereiro entra, e sua comissão também", async () => {
    const { data } = await rpcAs(tenantA.admin, "dre_report", {
      p_ini: INI,
      p_fim: FIM,
      p_regime: "competencia",
    });
    const report = data as Record<string, unknown>;

    expect(report.regime).toBe("competencia");
    expect(groupValue(report, "receitas", "Atendimentos")).toBe(30_000);
    expect((report.receitas as { total_cents: number }).total_cents).toBe(46_000);
    expect((report.custos as { total_cents: number }).total_cents).toBe(2_500);
    expect(report.margem_cents).toBe(43_500);
    expect(report.resultado_cents).toBe(39_500);
    expect(report.gorjeta_ignorada_cents).toBe(3_000);
  });

  it("série mensal contínua soma exatamente a tabela do período", async () => {
    for (const regime of ["caixa", "competencia"] as const) {
      const { data } = await rpcAs(tenantA.admin, "dre_report", {
        p_ini: INI,
        p_fim: FIM,
        p_regime: regime,
      });
      const report = data as {
        receitas: { total_cents: number };
        custos: { total_cents: number };
        despesas: { total_cents: number };
        resultado_cents: number;
        meses: {
          mes: string;
          receitas_cents: number;
          custos_cents: number;
          despesas_cents: number;
          resultado_cents: number;
        }[];
      };

      expect(report.meses).toHaveLength(1);
      expect(report.meses[0].mes).toBe("2026-01");
      const somas = report.meses.reduce(
        (acc, mes) => ({
          receitas: acc.receitas + mes.receitas_cents,
          custos: acc.custos + mes.custos_cents,
          despesas: acc.despesas + mes.despesas_cents,
          resultado: acc.resultado + mes.resultado_cents,
        }),
        { receitas: 0, custos: 0, despesas: 0, resultado: 0 },
      );
      expect(somas.receitas).toBe(report.receitas.total_cents);
      expect(somas.custos).toBe(report.custos.total_cents);
      expect(somas.despesas).toBe(report.despesas.total_cents);
      expect(somas.resultado).toBe(report.resultado_cents);
    }
  });

  it("regime inválido e janela acima do teto são recusados com código estável", async () => {
    const regime = await rpcAs(tenantA.admin, "dre_report", {
      p_ini: INI,
      p_fim: FIM,
      p_regime: "misto",
    });
    expect(regime.code).toBe("PT400");
    expect(regime.message).toContain("INVALID_REGIME");

    const janela = await rpcAs(tenantA.admin, "dre_report", {
      p_ini: "2025-01-01T00:00:00.000Z",
      p_fim: "2026-06-01T00:00:00.000Z",
      p_regime: "caixa",
    });
    expect(janela.code).toBe("PT400");
    expect(janela.message).toContain("RANGE_TOO_LARGE");
  });

  it("isolamento multi-tenant: B nunca vê os números de A", async () => {
    const { data } = await rpcAs(tenantB.admin, "dre_report", {
      p_ini: INI,
      p_fim: FIM,
      p_regime: "caixa",
    });
    const report = data as Record<string, unknown>;
    expect((report.receitas as { total_cents: number }).total_cents).toBe(0);
    expect((report.despesas as { total_cents: number }).total_cents).toBe(0);
    expect(report.resultado_cents).toBe(0);
  });
});

describe("dre_report — borda de competência (janela semiaberta)", () => {
  it("ciclo do mês seguinte pago em janeiro não entra na competência de janeiro", async () => {
    const { data, code } = await rpcAs(tenantD.admin, "dre_report", {
      p_ini: INI,
      p_fim: FIM,
      p_regime: "competencia",
    });
    expect(code).toBeUndefined();
    const report = data as {
      receitas: { total_cents: number; grupos: { categoria: string; valor_cents: number }[] };
      meses: { mes: string; receitas_cents: number; resultado_cents: number }[];
    };

    // Só o ciclo de janeiro: o de fevereiro é do mês seguinte, mesmo pago em janeiro.
    expect(groupValue(report as unknown as Record<string, unknown>, "receitas", "Recorrência")).toBe(
      9_000,
    );
    expect(report.receitas.total_cents).toBe(9_000);
    expect(report.meses).toHaveLength(1);
    expect(report.meses[0].mes).toBe("2026-01");

    // A série não pode divergir da tabela: era exatamente o defeito do `between`.
    const somaMeses = report.meses.reduce((acc, mes) => acc + mes.receitas_cents, 0);
    expect(somaMeses).toBe(report.receitas.total_cents);
  });

  it("caixa de janeiro reconhece os dois ciclos pela data de pagamento", async () => {
    const { data } = await rpcAs(tenantD.admin, "dre_report", {
      p_ini: INI,
      p_fim: FIM,
      p_regime: "caixa",
    });
    const report = data as { receitas: { total_cents: number } };
    expect(report.receitas.total_cents).toBe(21_345);
  });
});

describe("cashflow_30d — 30 dias e saldo acumulado", () => {
  it("entradas − saídas do dia e acumulado fecham no saldo final", async () => {
    const { data, code } = await rpcAs(tenantA.admin, "cashflow_30d", { p_base: "2026-01-01" });
    expect(code).toBeUndefined();
    const fluxo = data as {
      base: string;
      dias: {
        dia: string;
        entradas_cents: number;
        saidas_cents: number;
        saldo_dia_cents: number;
        saldo_acumulado_cents: number;
      }[];
      total_entradas_cents: number;
      total_saidas_cents: number;
      saldo_final_cents: number;
    };

    expect(fluxo.base).toBe("2026-01-01");
    expect(fluxo.dias).toHaveLength(30);
    expect(fluxo.total_entradas_cents).toBe(36_000);
    expect(fluxo.total_saidas_cents).toBe(4_000);
    expect(fluxo.saldo_final_cents).toBe(32_000);

    const somaDia = fluxo.dias.reduce((acc, dia) => acc + dia.saldo_dia_cents, 0);
    expect(somaDia).toBe(fluxo.saldo_final_cents);
    expect(fluxo.dias[fluxo.dias.length - 1].saldo_acumulado_cents).toBe(fluxo.saldo_final_cents);

    const dia12 = fluxo.dias.find((dia) => dia.dia === "2026-01-12");
    expect(dia12?.entradas_cents).toBe(20_000);
    const dia26 = fluxo.dias.find((dia) => dia.dia === "2026-01-26");
    expect(dia26?.saidas_cents).toBe(4_000);
    // Pagamento recebido em fevereiro não entra na janela de janeiro.
    expect(fluxo.dias.find((dia) => dia.dia === "2026-02-05")).toBeUndefined();
  });
});

describe("export_log_create — trilha do export de DRE", () => {
  it("grava log + auditoria e a leitura respeita RLS admin do tenant", async () => {
    const { data, code } = await rpcAs(tenantA.admin, "export_log_create", {
      p_tipo: "dre",
      p_periodo: "2026-01-01..2026-01-31",
      p_formato: "csv",
      p_arquivo_path: "dre-caixa-2026-01-01_2026-01-31.csv",
    });
    expect(code).toBeUndefined();
    const log = data as { id: string; created_at: string };
    expect(log.id).toBeTruthy();

    const logsA = await tenantA.admin.client
      .from("export_logs")
      .select("id, tipo, formato, periodo, arquivo_path");
    expect(logsA.error).toBeNull();
    expect(logsA.data).toHaveLength(1);
    expect(logsA.data?.[0]).toMatchObject({
      tipo: "dre",
      formato: "csv",
      periodo: "2026-01-01..2026-01-31",
      arquivo_path: "dre-caixa-2026-01-01_2026-01-31.csv",
    });

    // Cross-tenant: B (admin) não lê o log de A (RLS), e recepção de A também não.
    const logsB = await tenantB.admin.client.from("export_logs").select("id");
    expect(logsB.error).toBeNull();
    expect(logsB.data).toHaveLength(0);

    const logsRecepcao = await receptionist.client.from("export_logs").select("id");
    expect(logsRecepcao.error).toBeNull();
    expect(logsRecepcao.data).toHaveLength(0);

    expect(
      count(
        `select count(*) from public.audit_log
          where target_id = '${log.id}' and action = 'export_log_created';`,
      ),
    ).toBe(1);

    // Cliente não insere direto: sem policy de write, o INSERT é negado.
    const insert = await tenantA.admin.client.from("export_logs").insert({
      tipo: "dre",
      periodo: "2026-01-01..2026-01-31",
      formato: "csv",
    });
    expect(insert.error).not.toBeNull();
  });

  it("formato/tipo fora do contrato e entitlement ausente são recusados", async () => {
    const formato = await rpcAs(tenantA.admin, "export_log_create", {
      p_tipo: "dre",
      p_periodo: "2026-01",
      p_formato: "ofx",
    });
    expect(formato.code).toBe("PT400");

    const gate = await rpcAs(tenantC.admin, "export_log_create", {
      p_tipo: "dre",
      p_periodo: "2026-01",
      p_formato: "csv",
      p_arquivo_path: "dre-caixa-2026-01.csv",
    });
    expect(gate.code).toBe("PT403");
    expect(gate.message).toContain("FEATURE_DISABLED");
  });

  it("arquivo_path vazio é recusado: log exige entrega", async () => {
    for (const arquivoPath of [null, "", "   "]) {
      const { code, message } = await rpcAs(tenantA.admin, "export_log_create", {
        p_tipo: "fluxo",
        p_periodo: "2026-01-01..2026-01-30",
        p_formato: "csv",
        p_arquivo_path: arquivoPath,
      });
      expect(code).toBe("PT400");
      expect(message).toContain("INVALID_BODY");
    }
    expect(
      count(`select count(*) from public.export_logs where tenant_id = '${tenantA.tenantId}';`),
    ).toBe(1);
  });
});
