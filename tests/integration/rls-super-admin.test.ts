// RLS do super admin enquanto a troca de senha estiver pendente (ADR-03) e após a troca.
// Cobre CA-12 (leitura e escrita bloqueadas), CA-14 (leitura liberada após a troca) e CA-16
// (RLS ligado em profiles, tenants e toda tabela de domínio).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { serviceClient } from "./helpers/clients.ts";
import { sql } from "./helpers/sql.ts";
import {
  completePasswordChange,
  createCommonUser,
  createSuperAdminUser,
  deleteTestUsers,
  tenantIdOf,
  type TestUser,
} from "./helpers/users.ts";

let superAdmin: TestUser;
let target: TestUser;
let targetTenantId: string;

beforeAll(async () => {
  target = await createCommonUser("rls-target");
  targetTenantId = await tenantIdOf(target.id);
  // Evento de trilha para o caso de leitura de subscription_status_changes.
  const { error } = await serviceClient()
    .from("subscription_status_changes")
    .insert({ tenant_id: targetTenantId, old_status: "trial", new_status: "ativo" });
  if (error) throw new Error(`Preparação da trilha falhou: ${error.message}`);
  superAdmin = await createSuperAdminUser();
});

afterAll(async () => {
  await deleteTestUsers();
});

describe("CA-12 super admin com troca pendente não lê nem escreve empresa alheia", () => {
  it("select em tenants de outra empresa retorna zero linhas", async () => {
    const { data, error } = await superAdmin.client
      .from("tenants")
      .select("id")
      .eq("id", targetTenantId);
    expect(error).toBeNull();
    expect(data ?? []).toHaveLength(0);
  });

  it("select em subscription_status_changes retorna zero linhas", async () => {
    const { data } = await superAdmin.client
      .from("subscription_status_changes")
      .select("id")
      .eq("tenant_id", targetTenantId);
    expect(data ?? []).toHaveLength(0);
  });

  it("select em profiles de outro usuário retorna zero linhas", async () => {
    const { data } = await superAdmin.client.from("profiles").select("id").eq("id", target.id);
    expect(data ?? []).toHaveLength(0);
  });

  it("update em tenants de outra empresa não altera a linha", async () => {
    const before = await serviceClient()
      .from("tenants")
      .select("trade_name")
      .eq("id", targetTenantId)
      .single();

    const { data } = await superAdmin.client
      .from("tenants")
      .update({ trade_name: "alterado pelo super admin" })
      .eq("id", targetTenantId)
      .select("id");
    expect(data ?? []).toHaveLength(0);

    const after = await serviceClient()
      .from("tenants")
      .select("trade_name")
      .eq("id", targetTenantId)
      .single();
    expect(after.data?.trade_name).toBe(before.data?.trade_name);
  });
});

describe("CA-14 após a troca, leitura cross-tenant liberada", () => {
  it("com flag zerado, o super admin lê a empresa alheia", async () => {
    await completePasswordChange(superAdmin.id);

    const { data, error } = await superAdmin.client
      .from("tenants")
      .select("id")
      .eq("id", targetTenantId);
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
  });
});

describe("CA-16 RLS ligado nas tabelas de domínio", () => {
  it("profiles e tenants têm RLS ativo", () => {
    const rows = sql(
      `select relname || '=' || relrowsecurity from pg_class
        where relname in ('profiles','tenants') and relnamespace = 'public'::regnamespace
        order by relname;`,
    ).split("\n");
    expect(rows).toEqual(["profiles=true", "tenants=true"]);
  });

  it("toda tabela pública com tenant_id tem RLS ativo", () => {
    const domainTables = Number(
      sql(
        `select count(*) from pg_class c
          join pg_attribute a on a.attrelid = c.oid and a.attname = 'tenant_id' and not a.attisdropped
         where c.relkind = 'r' and c.relnamespace = 'public'::regnamespace;`,
      ),
    );
    expect(domainTables).toBeGreaterThan(0);

    const withoutRls = sql(
      `select string_agg(c.relname, ',') from pg_class c
          join pg_attribute a on a.attrelid = c.oid and a.attname = 'tenant_id' and not a.attisdropped
         where c.relkind = 'r' and c.relnamespace = 'public'::regnamespace
           and not c.relrowsecurity;`,
    );
    expect(withoutRls).toBe("");
  });
});
