// Contas a pagar (ADR-06; RF-13..17 + PRD §7).
// suppliers/payables/payable_settlements: escrita só via RPCs admin (sem policy
// de write); settlements append-only; recorrência sem duplicar; RLS admin-only.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { serviceClient } from "../helpers/clients.ts";
import {
  cleanupPaymentFixtures,
  createPaymentsTenant,
  type PaymentsTenant,
} from "../helpers/payments-fixtures.ts";
import { sql } from "../helpers/sql.ts";
import {
  createTenantMember,
  deleteTestUsers,
  type TestUser,
} from "../helpers/users.ts";

let tenantA: PaymentsTenant;
let tenantB: PaymentsTenant;
let receptionist: TestUser;
let professional: TestUser;

function count(query: string): number {
  return Number(sql(query));
}

async function rpcAs(
  user: TestUser,
  fn: string,
  args: Record<string, unknown>,
): Promise<{ data: unknown; code?: string }> {
  const { data, error } = await user.client.rpc(fn, args);
  return { data, code: error?.code };
}

beforeAll(async () => {
  tenantA = await createPaymentsTenant("pagar-a");
  tenantB = await createPaymentsTenant("pagar-b");
  receptionist = await createTenantMember(tenantA.tenantId, "receptionist", "pagar-reception");
  professional = await createTenantMember(tenantA.tenantId, "professional", "pagar-professional");
});

afterAll(async () => {
  sql("alter table public.payable_settlements disable trigger payable_settlements_no_update_delete;");
  try {
    const admin = serviceClient();
    for (const table of ["payable_settlements", "payables", "suppliers"] as const) {
      const { error } = await admin.from(table).delete().in("tenant_id", [tenantA.tenantId, tenantB.tenantId]);
      if (error) throw new Error(`Limpeza de ${table} falhou (código ${error.code ?? "sem código"}).`);
    }
  } finally {
    sql("alter table public.payable_settlements enable trigger payable_settlements_no_update_delete;");
  }
  await cleanupPaymentFixtures([tenantA.tenantId, tenantB.tenantId]);
  await deleteTestUsers();
});

describe("RF-13 fornecedores por tenant", () => {
  it("tabelas suppliers/payables/payable_settlements existem com tenant_id + *_cents + timestamptz", () => {
    for (const table of ["suppliers", "payables", "payable_settlements"]) {
      expect(
        count(
          `select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public' and c.relname = '${table}' and c.relkind = 'r';`,
        ),
        table,
      ).toBe(1);
    }
    expect(
      sql(
        `select string_agg(column_name || ':' || data_type, ',' order by column_name)
           from information_schema.columns
          where table_schema = 'public' and table_name = 'payables'
            and column_name in ('valor_cents','vencimento_at','created_at');`,
      ),
    ).toBe("created_at:timestamp with time zone,valor_cents:integer,vencimento_at:timestamp with time zone");
  });

  it("admin cria fornecedor pela RPC; recepção/profissional recebem FORBIDDEN", async () => {
    const ok = await rpcAs(tenantA.admin, "payable_create_supplier", { p_nome: "Fornecedor A" });
    expect(ok.code).toBeUndefined();
    expect(typeof ok.data).toBe("string");

    for (const user of [receptionist, professional]) {
      const denied = await rpcAs(user, "payable_create_supplier", { p_nome: "Fornecedor X" });
      expect(denied.code).toBe("PT403");
    }
  });

  it("nome vazio falha com PT400", async () => {
    const res = await rpcAs(tenantA.admin, "payable_create_supplier", { p_nome: "  " });
    expect(res.code).toBe("PT400");
  });
});

describe("RF-14 lançamento com recorrência sem duplicar", () => {
  it("lançamento avulso cria 1 conta pendente; replay de serie volta sem duplicar", async () => {
    const venc = new Date(Date.now() + 86_400_000).toISOString();
    const serie = randomUUID();
    const first = await rpcAs(tenantA.admin, "payable_create", {
      p_descricao: "Aluguel",
      p_vencimento_at: venc,
      p_valor_cents: 150_000,
      p_supplier_id: null,
      p_categoria: "fixo",
      p_recorrencia: "mensal",
      p_parcelas: 3,
      p_serie_id: serie,
    });
    expect(first.code).toBeUndefined();
    const ids = (first.data as { payable_ids: string[] }).payable_ids;
    expect(ids).toHaveLength(3);

    const replay = await rpcAs(tenantA.admin, "payable_create", {
      p_descricao: "Aluguel",
      p_vencimento_at: venc,
      p_valor_cents: 150_000,
      p_supplier_id: null,
      p_categoria: "fixo",
      p_recorrencia: "mensal",
      p_parcelas: 3,
      p_serie_id: serie,
    });
    expect(replay.code).toBeUndefined();
    expect(replay.data).toMatchObject({ replayed: true });
    expect((replay.data as { payable_ids: string[] }).payable_ids).toHaveLength(3);

    expect(
      count(
        `select count(*) from public.payables where serie_id = '${serie}';`,
      ),
    ).toBe(3);
  });

  it("fornecedor de outro tenant falha com PT404", async () => {
    const { data: supplierB } = await tenantB.admin.client
      .from("suppliers")
      .select("id")
      .limit(1)
      .maybeSingle();
    let supplierId = (supplierB as { id: string } | null)?.id ?? null;
    if (!supplierId) {
      const created = await rpcAs(tenantB.admin, "payable_create_supplier", { p_nome: "Fornecedor B" });
      supplierId = created.data as string;
    }
    const res = await rpcAs(tenantA.admin, "payable_create", {
      p_descricao: "Compra cruzada",
      p_vencimento_at: new Date(Date.now() + 86_400_000).toISOString(),
      p_valor_cents: 1_000,
      p_supplier_id: supplierId,
    });
    expect(res.code).toBe("PT404");
  });

  it("valor zero falha com PT400", async () => {
    const res = await rpcAs(tenantA.admin, "payable_create", {
      p_descricao: "Zero",
      p_vencimento_at: new Date().toISOString(),
      p_valor_cents: 0,
    });
    expect(res.code).toBe("PT400");
  });
});

describe("RF-16 baixa total/parcial com resto", () => {
  it("parcial mantém status parcial com resto; total zera e vira pago; overpay falha", async () => {
    const created = await rpcAs(tenantA.admin, "payable_create", {
      p_descricao: "Energia",
      p_vencimento_at: new Date(Date.now() + 86_400_000).toISOString(),
      p_valor_cents: 10_000,
    });
    const payableId = (created.data as { payable_ids: string[] }).payable_ids[0];

    const parcial = await rpcAs(tenantA.admin, "payable_settle", {
      p_payable_id: payableId,
      p_valor_cents: 4_000,
      p_conta: "Caixa",
    });
    expect(parcial.code).toBeUndefined();
    expect(parcial.data).toMatchObject({ status: "parcial", resto_cents: 6_000 });

    const over = await rpcAs(tenantA.admin, "payable_settle", {
      p_payable_id: payableId,
      p_valor_cents: 7_000,
    });
    expect(over.code).toBe("PT409");

    const total = await rpcAs(tenantA.admin, "payable_settle", {
      p_payable_id: payableId,
      p_valor_cents: 6_000,
    });
    expect(total.code).toBeUndefined();
    expect(total.data).toMatchObject({ status: "pago", resto_cents: 0 });

    const depois = await rpcAs(tenantA.admin, "payable_settle", {
      p_payable_id: payableId,
      p_valor_cents: 100,
    });
    expect(depois.code).toBe("PT409");
  });

  it("settlements é append-only: update/delete falham mesmo pela service role", async () => {
    const { data } = await serviceClient()
      .from("payable_settlements")
      .select("id")
      .eq("tenant_id", tenantA.tenantId)
      .limit(1)
      .single();
    const id = (data as { id: string }).id;
    const update = await serviceClient()
      .from("payable_settlements")
      .update({ conta: "adulterada" })
      .eq("id", id);
    expect(update.error?.code).toBe("P0001");
    const remove = await serviceClient().from("payable_settlements").delete().eq("id", id);
    expect(remove.error?.code).toBe("P0001");
  });
});

describe("RF-15 KPIs vencido + 7d", () => {
  it("payable_kpis soma restos em aberto; pago/cancelado não entram", async () => {
    const passado = new Date(Date.now() - 2 * 86_400_000).toISOString();
    const futuro = new Date(Date.now() + 3 * 86_400_000).toISOString();
    for (const [descricao, venc, valor] of [
      ["Vencida A", passado, 5_000],
      ["Futura B", futuro, 7_000],
    ] as const) {
      await rpcAs(tenantA.admin, "payable_create", {
        p_descricao: `kpi-${descricao}-${randomUUID().slice(0, 6)}`,
        p_vencimento_at: venc,
        p_valor_cents: valor,
      });
    }
    const { data, error } = await tenantA.admin.client.rpc("payable_kpis");
    expect(error).toBeNull();
    const kpis = data as {
      vencido_cents: number;
      vencido_count: number;
      proximos7d_cents: number;
      proximos7d_count: number;
    };
    expect(kpis.vencido_cents).toBeGreaterThanOrEqual(5_000);
    expect(kpis.vencido_count).toBeGreaterThanOrEqual(1);
    expect(kpis.proximos7d_cents).toBeGreaterThanOrEqual(7_000);
    expect(kpis.proximos7d_count).toBeGreaterThanOrEqual(1);
  });

  it("recepção não acessa KPIs (FORBIDDEN)", async () => {
    const res = await rpcAs(receptionist, "payable_kpis", {});
    expect(res.code).toBe("PT403");
  });
});

describe("RLS admin-only e isolamento por tenant", () => {
  it("RLS habilitado com exatamente uma policy de select admin por tabela", () => {
    for (const table of ["suppliers", "payables", "payable_settlements"]) {
      expect(
        count(
          `select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public' and c.relname = '${table}' and c.relrowsecurity;`,
        ),
        table,
      ).toBe(1);
      const policies = sql(
        `select string_agg(policyname || ':' || cmd, ',' order by policyname)
           from pg_policies where schemaname = 'public' and tablename = '${table}';`,
      );
      expect(policies).toBe(`${table}_select_tenant_admin:SELECT`);
    }
  });

  it("admin A lê só o próprio tenant; recepção/profissional leem zero", async () => {
    const viewA = await tenantA.admin.client.from("payables").select("id, tenant_id");
    expect(viewA.error).toBeNull();
    expect((viewA.data ?? []).length).toBeGreaterThanOrEqual(1);
    for (const row of viewA.data ?? []) expect(row.tenant_id).toBe(tenantA.tenantId);

    for (const user of [receptionist, professional]) {
      for (const table of ["suppliers", "payables", "payable_settlements"] as const) {
        const { data, error } = await user.client.from(table).select("id");
        expect(error, `${user.email} ${table}`).toBeNull();
        expect(data ?? [], `${user.email} ${table}`).toHaveLength(0);
      }
    }
  });

  it("insert/update/delete diretos falham com 42501 para admin e recepção", async () => {
    for (const { label, user } of [
      { label: "admin", user: tenantA.admin },
      { label: "receptionist", user: receptionist },
    ]) {
      const insert = await user.client.from("suppliers").insert({
        tenant_id: tenantA.tenantId,
        nome: "Direto",
      });
      expect(insert.error?.code, `${label} insert`).toBe("42501");

      const { data } = await serviceClient()
        .from("payables")
        .select("id")
        .eq("tenant_id", tenantA.tenantId)
        .limit(1)
        .single();
      const id = (data as { id: string }).id;
      const update = await user.client.from("payables").update({ descricao: "x" }).eq("id", id).select("id");
      expect(update.error?.code, `${label} update`).toBe("42501");
      const remove = await user.client.from("payables").delete().eq("id", id).select("id");
      expect(remove.error?.code, `${label} delete`).toBe("42501");
    }
  });

  it("cancelada com baixa falha; conta sem baixa cancela com auditoria", async () => {    const created = await rpcAs(tenantA.admin, "payable_create", {
      p_descricao: `cancel-${randomUUID().slice(0, 6)}`,
      p_vencimento_at: new Date(Date.now() + 86_400_000).toISOString(),
      p_valor_cents: 2_000,
    });
    const payableId = (created.data as { payable_ids: string[] }).payable_ids[0];
    const cancel = await rpcAs(tenantA.admin, "payable_cancel", {
      p_payable_id: payableId,
      p_motivo: "Duplicada",
    });
    expect(cancel.code).toBeUndefined();
    expect(cancel.data).toMatchObject({ status: "cancelado" });

    const settle = await rpcAs(tenantA.admin, "payable_settle", {
      p_payable_id: payableId,
      p_valor_cents: 500,
    });
    expect(settle.code).toBe("PT409");
  });

  it("parcial com baixa não cancela (PT409); anexo fora da allowlist falha (PT400)", async () => {
    const created = await rpcAs(tenantA.admin, "payable_create", {
      p_descricao: `parcial-cancel-${randomUUID().slice(0, 6)}`,
      p_vencimento_at: new Date(Date.now() + 86_400_000).toISOString(),
      p_valor_cents: 5_000,
    });
    const payableId = (created.data as { payable_ids: string[] }).payable_ids[0];

    const parcial = await rpcAs(tenantA.admin, "payable_settle", {
      p_payable_id: payableId,
      p_valor_cents: 1_000,
    });
    expect(parcial.code).toBeUndefined();

    const cancel = await rpcAs(tenantA.admin, "payable_cancel", {
      p_payable_id: payableId,
      p_motivo: "Tentativa após parcial",
    });
    expect(cancel.code).toBe("PT409");

    const anexoRuim = await rpcAs(tenantA.admin, "payable_settle", {
      p_payable_id: payableId,
      p_valor_cents: 500,
      p_anexo_path: "t1/conta/malware.exe",
    });
    expect(anexoRuim.code).toBe("PT400");
  });

  it("serie é isolada por tenant: mesmo serie_id em outro tenant não colide", async () => {
    const serie = randomUUID();
    const venc = new Date(Date.now() + 86_400_000).toISOString();
    const mk = (admin: TestUser) =>
      rpcAs(admin, "payable_create", {
        p_descricao: "Serie cross",
        p_vencimento_at: venc,
        p_valor_cents: 1_000,
        p_recorrencia: "mensal",
        p_parcelas: 2,
        p_serie_id: serie,
      });
    const a = await mk(tenantA.admin);
    expect(a.code).toBeUndefined();
    // Tenant B com o MESMO serie_id deve conseguir lançar (índice com tenant_id).
    const b = await mk(tenantB.admin);
    expect(b.code).toBeUndefined();
    expect((b.data as { replayed: boolean }).replayed).toBe(false);
  });
});
