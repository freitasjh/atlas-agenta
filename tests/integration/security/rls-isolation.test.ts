// Isolamento entre empresas (RQ-14 da ADR-13): o admin da empresa A não lê `tenants`,
// `profiles` nem tabela de domínio da empresa B. A consulta ao catálogo garante que nenhuma
// policy voltou a referenciar o flag de troca de senha removido na ADR-12.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { serviceClient } from "../helpers/clients.ts";
import { ensureFunctionsDefault } from "../helpers/functions-server.ts";
import { sql } from "../helpers/sql.ts";
import {
  createCommonUser,
  deleteTestUsers,
  tenantIdOf,
  type TestUser,
} from "../helpers/users.ts";

let adminA: TestUser;
let adminB: TestUser;
let tenantA: string;
let tenantB: string;
let customerB: string;

beforeAll(async () => {
  await ensureFunctionsDefault();
  adminA = await createCommonUser("rls-a");
  adminB = await createCommonUser("rls-b");
  tenantA = await tenantIdOf(adminA.id);
  tenantB = await tenantIdOf(adminB.id);

  const { data, error } = await serviceClient()
    .from("customers")
    .insert({ tenant_id: tenantB, name: "Cliente da empresa B", phone: "11999999999" })
    .select("id")
    .single();
  if (error || !data) throw new Error("Preparação do cliente da empresa B falhou.");
  customerB = data.id;
});

afterAll(async () => {
  await deleteTestUsers();
});

describe("RQ-14 admin da empresa A não vê dados da empresa B", () => {
  it("select em tenants da empresa B retorna zero linhas", async () => {
    const { data, error } = await adminA.client.from("tenants").select("id").eq("id", tenantB);
    expect(error).toBeNull();
    expect(data ?? []).toHaveLength(0);
  });

  it("select em profiles da empresa B retorna zero linhas", async () => {
    const { data, error } = await adminA.client.from("profiles").select("id").eq("id", adminB.id);
    expect(error).toBeNull();
    expect(data ?? []).toHaveLength(0);
  });

  it("select em customers da empresa B retorna zero linhas", async () => {
    const { data, error } = await adminA.client
      .from("customers")
      .select("id")
      .eq("tenant_id", tenantB);
    expect(error).toBeNull();
    expect(data ?? []).toHaveLength(0);
    expect(customerB).not.toBe("");
  });

  it("admin da empresa A lê os próprios dados", async () => {
    const { data } = await adminA.client.from("tenants").select("id").eq("id", tenantA);
    expect(data ?? []).toHaveLength(1);
  });
});

describe("RQ-14 catálogo sem referência ao flag removido", () => {
  it("nenhuma policy cita must_change_password ou current_must_change_password", () => {
    const policies = Number(
      sql(`select count(*) from pg_policies
            where qual::text like '%must_change_password%'
               or with_check::text like '%must_change_password%'
               or qual::text like '%current_must_change_password%'
               or with_check::text like '%current_must_change_password%';`),
    );
    expect(policies).toBe(0);
  });

  it("toda tabela pública com tenant_id tem RLS ativo", () => {
    const withoutRls = sql(
      `select coalesce(string_agg(c.relname, ','), '') from pg_class c
         join pg_attribute a on a.attrelid = c.oid and a.attname = 'tenant_id' and not a.attisdropped
        where c.relkind = 'r' and c.relnamespace = 'public'::regnamespace
          and not c.relrowsecurity;`,
    );
    expect(withoutRls).toBe("");
  });
});
