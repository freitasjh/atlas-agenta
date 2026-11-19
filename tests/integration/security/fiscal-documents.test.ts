// Fiscal schema (ADR-02; RF-02, RF-03, RF-04, RF-40 + fronteiras §7).
// `fiscal_documents` (1 por origem, idempotente) + `fiscal_events` (append-only).
// O `sql()` roda como owner e bypassa RLS; recorte por tenant e negação de escrita
// são provados com sessões autenticadas reais (JWT do GoTrue local).
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { serviceClient } from "../helpers/clients.ts";
import {
  cleanupPaymentFixtures,
  createPaymentsTenant,
  seedAppointment,
  type AppointmentFixture,
  type PaymentsTenant,
} from "../helpers/payments-fixtures.ts";
import { sql } from "../helpers/sql.ts";
import {
  createSuperAdminUser,
  createTenantMember,
  deleteTestUsers,
  type TestUser,
} from "../helpers/users.ts";

let tenantA: PaymentsTenant;
let tenantB: PaymentsTenant;
let fixtureA: AppointmentFixture;
let receptionist: TestUser;
let professional: TestUser;
let superAdmin: TestUser;
let docIdA: string;

function count(query: string): number {
  return Number(sql(query));
}

async function insertDocument(row: Record<string, unknown>) {
  return serviceClient().from("fiscal_documents").insert(row);
}

async function insertDocumentWithId(row: Record<string, unknown>): Promise<string> {
  const { data, error } = await serviceClient()
    .from("fiscal_documents")
    .insert(row)
    .select("id")
    .single();
  if (error || !data) throw new Error(`Seed fiscal falhou (código ${error?.code ?? "vazio"}).`);
  return data.id;
}

async function insertEvent(row: Record<string, unknown>) {
  return serviceClient().from("fiscal_events").insert(row);
}

const AUTORIZADA = {
  numero: "123",
  serie: "1",
  status: "autorizada",
  xml: "<nfe>autorizada</nfe>",
  authorized_at: new Date().toISOString(),
};

/** Chave de 44 dígitos única por chamada (colisão entre blocos é 23505 real). */
function uniqueChave(): string {
  const tail = Math.floor(Math.random() * 10_000_000_000)
    .toString()
    .padStart(10, "0");
  return `3526011234567800019555001000000123${tail}`.slice(0, 44);
}

beforeAll(async () => {
  tenantA = await createPaymentsTenant("fiscal-a");
  tenantB = await createPaymentsTenant("fiscal-b");
  fixtureA = await seedAppointment(tenantA.tenantId);
  await seedAppointment(tenantB.tenantId);

  receptionist = await createTenantMember(tenantA.tenantId, "receptionist", "fiscal-reception");
  professional = await createTenantMember(tenantA.tenantId, "professional", "fiscal-professional");
  superAdmin = await createSuperAdminUser("fiscal-super");

  docIdA = await insertDocumentWithId({
    tenant_id: tenantA.tenantId,
    origem_tipo: "appointment",
    origem_id: fixtureA.appointmentId,
    valor_cents: 10_000,
  });
  await insertEvent({
    tenant_id: tenantA.tenantId,
    fiscal_document_id: docIdA,
    tipo: "emissao",
    motivo: "emissão solicitada",
    created_by: tenantA.admin.id,
  });
});

afterAll(async () => {
  // O trigger append-only barra DELETE até da service_role (é a garantia); a
  // limpeza desliga o trigger como owner (DDL, nunca via API) e religa em seguida.
  sql("alter table public.fiscal_events disable trigger fiscal_events_no_update_delete;");
  try {
    const admin = serviceClient();
    for (const table of ["fiscal_events", "fiscal_documents"] as const) {
      const { error } = await admin.from(table).delete().in("tenant_id", [tenantA.tenantId, tenantB.tenantId]);
      if (error) throw new Error(`Limpeza de ${table} falhou (código ${error.code ?? "sem código"}).`);
    }
  } finally {
    sql("alter table public.fiscal_events enable trigger fiscal_events_no_update_delete;");
  }
  await cleanupPaymentFixtures([tenantA.tenantId, tenantB.tenantId]);
  await deleteTestUsers();
});

describe("RF-02 catálogo fiscal", () => {
  it("tabelas fiscal_documents e fiscal_events existem em public", () => {
    for (const table of ["fiscal_documents", "fiscal_events"]) {
      expect(
        count(
          `select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public' and c.relname = '${table}' and c.relkind = 'r';`,
        ),
        table,
      ).toBe(1);
    }
  });

  it("fiscal_documents tem as colunas e tipos declarados", () => {
    const columns = sql(
      `select string_agg(column_name, ',' order by column_name)
         from information_schema.columns
        where table_schema = 'public' and table_name = 'fiscal_documents';`,
    );
    expect(columns.split(",").sort()).toEqual(
      [
        "id",
        "tenant_id",
        "origem_tipo",
        "origem_id",
        "numero",
        "serie",
        "chave_acesso",
        "status",
        "valor_cents",
        "xml",
        "danfe_url",
        "created_at",
        "authorized_at",
      ].sort(),
    );
    expect(
      sql(
        `select string_agg(column_name || ':' || data_type, ',' order by column_name)
           from information_schema.columns
          where table_schema = 'public' and table_name = 'fiscal_documents'
            and column_name in ('valor_cents','created_at','authorized_at','origem_id');`,
      ),
    ).toBe(
      "authorized_at:timestamp with time zone,created_at:timestamp with time zone,origem_id:uuid,valor_cents:integer",
    );
  });

  it("fiscal_events tem as colunas e tipos declarados", () => {
    const columns = sql(
      `select string_agg(column_name, ',' order by column_name)
         from information_schema.columns
        where table_schema = 'public' and table_name = 'fiscal_events';`,
    );
    expect(columns.split(",").sort()).toEqual(
      ["id", "tenant_id", "fiscal_document_id", "tipo", "motivo", "payload", "created_by", "created_at"].sort(),
    );
  });

  it("checks de enums, valores e autorização estão no catálogo", () => {
    const checks = sql(
      `select string_agg(conname, ',' order by conname)
         from pg_constraint
        where conrelid = 'public.fiscal_documents'::regclass and contype = 'c';`,
    );
    expect(checks.split(",").sort()).toEqual(
      [
        "fiscal_documents_origem_tipo_check",
        "fiscal_documents_status_check",
        "fiscal_documents_valor_cents_check",
        "fiscal_documents_autorizada_check",
        "fiscal_documents_cancelada_check",
        "fiscal_documents_chave_formato_check",
      ].sort(),
    );
    const eventChecks = sql(
      `select string_agg(conname, ',' order by conname)
         from pg_constraint
        where conrelid = 'public.fiscal_events'::regclass and contype = 'c';`,
    );
    expect(eventChecks).toBe("fiscal_events_tipo_check");
  });

  it("unicidade por origem cobre idempotência; chave só colide quando informada", () => {
    const indexes = sql(
      `select string_agg(indexname, ',' order by indexname)
         from pg_indexes where schemaname = 'public'
           and indexname in ('fiscal_documents_origem_uidx','fiscal_documents_chave_uidx');`,
    );
    expect(indexes.split(",").sort()).toEqual(
      ["fiscal_documents_chave_uidx", "fiscal_documents_origem_uidx"].sort(),
    );
  });

  it("fiscal_events referencia o documento pela FK composta por tenant", () => {
    const fks = sql(
      `select string_agg(conname || ':' || array_length(conkey, 1), ',' order by conname)
         from pg_constraint
        where conrelid = 'public.fiscal_events'::regclass and contype = 'f'
          and array_length(conkey, 1) >= 2;`,
    );
    expect(fks.split(",").sort()).toEqual(
      ["fiscal_events_created_by_fk:2", "fiscal_events_document_fk:2"].sort(),
    );
  });

  it("trigger de append-only existe em fiscal_events", () => {
    expect(
      count(
        `select count(*) from pg_trigger where tgrelid = 'public.fiscal_events'::regclass
           and not tgisinternal and tgname = 'fiscal_events_no_update_delete';`,
      ),
    ).toBe(1);
  });
});

describe("RF-40 idempotência por origem", () => {
  it("segundo documento da mesma origem falha com 23505; origem distinta passa", async () => {
    const replay = await insertDocument({
      tenant_id: tenantA.tenantId,
      origem_tipo: "appointment",
      origem_id: fixtureA.appointmentId,
      valor_cents: 10_000,
    });
    expect(replay.error?.code).toBe("23505");

    const otherOrigin = await insertDocument({
      tenant_id: tenantA.tenantId,
      origem_tipo: "sale",
      origem_id: fixtureA.appointmentId,
      valor_cents: 10_000,
    });
    expect(otherOrigin.error).toBeNull();
  });

  it("mesma origem em outro tenant não colide", async () => {
    const { error } = await insertDocument({
      tenant_id: tenantB.tenantId,
      origem_tipo: "appointment",
      origem_id: fixtureA.appointmentId,
      valor_cents: 10_000,
    });
    expect(error).toBeNull();
  });

  it("chave_acesso duplicada falha; nula não colide", async () => {
    const fixture = await seedAppointment(tenantA.tenantId);
    const chave = uniqueChave();
    const first = await insertDocument({
      tenant_id: tenantA.tenantId,
      origem_tipo: "appointment",
      origem_id: fixture.appointmentId,
      valor_cents: 5_000,
      ...AUTORIZADA,
      chave_acesso: chave,
    });
    expect(first.error).toBeNull();

    const fixture2 = await seedAppointment(tenantA.tenantId);
    const dup = await insertDocument({
      tenant_id: tenantA.tenantId,
      origem_tipo: "appointment",
      origem_id: fixture2.appointmentId,
      valor_cents: 5_000,
      ...AUTORIZADA,
      chave_acesso: chave,
    });
    expect(dup.error?.code).toBe("23505");

    const fixture3 = await seedAppointment(tenantA.tenantId);
    const withoutKey = await insertDocument({
      tenant_id: tenantA.tenantId,
      origem_tipo: "appointment",
      origem_id: fixture3.appointmentId,
      valor_cents: 5_000,
    });
    expect(withoutKey.error).toBeNull();
  });
});

describe("RF-02 invariantes de valores e status", () => {
  it("valor_cents = 0 falha com 23514", async () => {
    const { error } = await insertDocument({
      tenant_id: tenantA.tenantId,
      origem_tipo: "appointment",
      origem_id: randomUUID(),
      valor_cents: 0,
    });
    expect(error?.code).toBe("23514");
  });

  it("origem_tipo e status fora do enum falham com 23514", async () => {
    for (const row of [
      { origem_tipo: "subscription", status: "pendente" },
      { origem_tipo: "appointment", status: "emitida" },
    ]) {
      const { error } = await insertDocument({
        tenant_id: tenantA.tenantId,
        origem_id: randomUUID(),
        valor_cents: 100,
        ...row,
      });
      expect(error?.code, JSON.stringify(row)).toBe("23514");
    }
  });

  it("autorizada exige chave, xml e authorized_at (23514 sem eles)", async () => {
    const { error } = await insertDocument({
      tenant_id: tenantA.tenantId,
      origem_tipo: "appointment",
      origem_id: randomUUID(),
      valor_cents: 100,
      status: "autorizada",
    });
    expect(error?.code).toBe("23514");
  });

  it("chave_acesso fora do formato (não 44 dígitos) falha com 23514", async () => {
    const { error } = await insertDocument({
      tenant_id: tenantA.tenantId,
      origem_tipo: "appointment",
      origem_id: randomUUID(),
      valor_cents: 100,
      ...AUTORIZADA,
      chave_acesso: "123",
    });
    expect(error?.code).toBe("23514");
  });

  it("tipo de evento fora do enum falha com 23514", async () => {
    const { error } = await insertEvent({
      tenant_id: tenantA.tenantId,
      fiscal_document_id: docIdA,
      tipo: "reemissao",
    });
    expect(error?.code).toBe("23514");
  });
});

describe("RF-04 cancelamento preserva XML/DANFE", () => {
  it("cancelada sem xml falha; com xml o update preserva o conteúdo", async () => {
    const noXml = await insertDocument({
      tenant_id: tenantA.tenantId,
      origem_tipo: "appointment",
      origem_id: randomUUID(),
      valor_cents: 100,
      status: "cancelada",
    });
    expect(noXml.error?.code).toBe("23514");

    const id = await insertDocumentWithId({
      tenant_id: tenantA.tenantId,
      origem_tipo: "appointment",
      origem_id: randomUUID(),
      valor_cents: 7_500,
      ...AUTORIZADA,
      chave_acesso: uniqueChave(),
      danfe_url: "https://storage/danfe/123.pdf",
    });
    const { error } = await serviceClient()
      .from("fiscal_documents")
      .update({ status: "cancelada" })
      .eq("id", id);
    expect(error).toBeNull();

    const { data, error: readError } = await serviceClient()
      .from("fiscal_documents")
      .select("status, xml, danfe_url")
      .eq("id", id)
      .single();
    expect(readError).toBeNull();
    expect(data?.status).toBe("cancelada");
    expect(data?.xml).toBe("<nfe>autorizada</nfe>");
    expect(data?.danfe_url).toBe("https://storage/danfe/123.pdf");
  });
});

describe("append-only de fiscal_events", () => {
  it("update e delete falham mesmo pela service role (P0001 do trigger)", async () => {
    const { data } = await serviceClient()
      .from("fiscal_events")
      .select("id")
      .eq("tenant_id", tenantA.tenantId)
      .limit(1)
      .single();
    const eventId = (data as { id: string }).id;

    const update = await serviceClient()
      .from("fiscal_events")
      .update({ motivo: "adulterado" })
      .eq("id", eventId);
    expect(update.error?.code).toBe("P0001");

    const remove = await serviceClient().from("fiscal_events").delete().eq("id", eventId);
    expect(remove.error?.code).toBe("P0001");
  });

  it("evento de outro tenant falha na FK composta (23503)", async () => {
    const { error } = await insertEvent({
      tenant_id: tenantB.tenantId,
      fiscal_document_id: docIdA,
      tipo: "carta",
      motivo: "correção",
    });
    expect(error?.code).toBe("23503");
  });
});

describe("RLS admin-only e isolamento por tenant", () => {
  it("grants: authenticated só SELECT; anon nada; service_role tudo", () => {
    for (const table of ["fiscal_documents", "fiscal_events"]) {
      expect(sql(`select has_table_privilege('authenticated','public.${table}','SELECT');`)).toBe("t");
      for (const privilege of ["INSERT", "UPDATE", "DELETE", "TRUNCATE"]) {
        expect(
          sql(`select has_table_privilege('authenticated','public.${table}','${privilege}');`),
          `${table} authenticated ${privilege}`,
        ).toBe("f");
      }
      for (const privilege of ["SELECT", "INSERT", "UPDATE", "DELETE"]) {
        expect(
          sql(`select has_table_privilege('anon','public.${table}','${privilege}');`),
          `${table} anon ${privilege}`,
        ).toBe("f");
        expect(
          sql(`select has_table_privilege('service_role','public.${table}','${privilege}');`),
          `${table} service_role ${privilege}`,
        ).toBe("t");
      }
    }
  });

  it("RLS habilitado com exatamente uma policy de select admin por tabela", () => {
    for (const table of ["fiscal_documents", "fiscal_events"]) {
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

  it("admin A lê só o próprio tenant; admin B só o dele", async () => {
    const viewA = await tenantA.admin.client.from("fiscal_documents").select("id, tenant_id");
    expect(viewA.error).toBeNull();
    expect((viewA.data ?? []).length).toBeGreaterThanOrEqual(1);
    for (const row of viewA.data ?? []) expect(row.tenant_id).toBe(tenantA.tenantId);

    const viewB = await tenantB.admin.client.from("fiscal_documents").select("id, tenant_id");
    expect(viewB.error).toBeNull();
    for (const row of viewB.data ?? []) expect(row.tenant_id).toBe(tenantB.tenantId);
  });

  it("recepção, profissional e super_admin leem zero linhas", async () => {
    for (const user of [receptionist, professional, superAdmin]) {
      for (const table of ["fiscal_documents", "fiscal_events"] as const) {
        const { data, error } = await user.client.from(table).select("id");
        expect(error, `${user.email} ${table}`).toBeNull();
        expect(data ?? [], `${user.email} ${table}`).toHaveLength(0);
      }
    }
  });

  it("insert, update e delete falham com 42501 para admin, recepção e profissional", async () => {
    const users = [
      { label: "admin", user: tenantA.admin },
      { label: "receptionist", user: receptionist },
      { label: "professional", user: professional },
    ];
    for (const { label, user } of users) {
      const insert = await user.client.from("fiscal_documents").insert({
        tenant_id: tenantA.tenantId,
        origem_tipo: "appointment",
        origem_id: randomUUID(),
        valor_cents: 700,
      });
      expect(insert.error?.code, `${label} insert`).toBe("42501");

      const update = await user.client
        .from("fiscal_documents")
        .update({ numero: "999" })
        .eq("id", docIdA)
        .select("id");
      expect(update.error?.code, `${label} update`).toBe("42501");

      const remove = await user.client.from("fiscal_documents").delete().eq("id", docIdA).select("id");
      expect(remove.error?.code, `${label} delete`).toBe("42501");
    }
  });

  it("insert direto em fiscal_events também falha com 42501", async () => {
    const { error } = await tenantA.admin.client.from("fiscal_events").insert({
      tenant_id: tenantA.tenantId,
      fiscal_document_id: docIdA,
      tipo: "carta",
    });
    expect(error?.code).toBe("42501");
  });
});
