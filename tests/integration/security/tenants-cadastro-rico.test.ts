// ADR-001 (cadastro empresa rico): colunas de endereco em `tenants` + checks de
// formato canonico (IT-01) e RLS do endereco (IT-02). Sem PII em logs: nenhum
// valor de documento/telefone e impresso ou registrado aqui.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { serviceClient } from "../helpers/clients.ts";
import { sql } from "../helpers/sql.ts";
import {
  createCommonUser,
  deleteTestUsers,
  tenantIdOf,
  type TestUser,
} from "../helpers/users.ts";

const MIGRATION_FILE =
  "supabase/migrations/20261104192210_tenants_cadastro_rico_endereco.sql";

function count(query: string): number {
  return Number(sql(query));
}

/** Documento ficticio de 14 digitos, unico por chamada (evita o indice parcial). */
function fakeDocument(): string {
  const base = `${Date.now()}${Math.floor(Math.random() * 1_000_000)}`.replace(/\D/g, "");
  return base.padStart(14, "7").slice(-14);
}

const createdTenants: string[] = [];

async function insertTenant(row: Record<string, string | null>): Promise<string> {
  const { data, error } = await serviceClient().from("tenants").insert(row).select("id").single();
  if (error || !data) throw new Error(`Insert de empresa de teste falhou (codigo ${error?.code ?? "vazio"}).`);
  createdTenants.push(data.id as string);
  return data.id as string;
}

afterAll(async () => {
  if (createdTenants.length > 0) {
    const { error } = await serviceClient().from("tenants").delete().in("id", createdTenants);
    createdTenants.length = 0;
    if (error) throw new Error(`Limpeza das empresas de teste falhou (codigo ${error.code ?? "vazio"}).`);
  }
  await deleteTestUsers();
});

describe("IT-01 colunas de endereco e checks (ADR-001)", () => {
  it("seis colunas de endereco existem em tenants", () => {
    expect(
      count(
        `select count(*) from information_schema.columns
          where table_schema = 'public' and table_name = 'tenants'
            and column_name in ('address_cep','address_street','address_number',
              'address_complement','address_city','address_state');`,
      ),
    ).toBe(6);
  });

  it("quatro checks de formato existem", () => {
    expect(
      count(
        `select count(*) from pg_constraint
          where conrelid = 'public.tenants'::regclass
            and conname in ('tenants_cep_digits','tenants_uf',
              'tenants_document_digits','tenants_phone_digits');`,
      ),
    ).toBe(4);
  });

  it("indice parcial tenants_document_key mantido", () => {
    expect(
      count(
        `select count(*) from pg_index i
            join pg_class c on c.oid = i.indexrelid
          where c.relname = 'tenants_document_key' and i.indpred is not null;`,
      ),
    ).toBe(1);
  });

  it("re-aplicacao da migration e idempotente", () => {
    const ddl = readFileSync(fileURLToPath(new URL(`../../../${MIGRATION_FILE}`, import.meta.url)), "utf8");
    expect(() => sql(ddl)).not.toThrow();
    expect(
      count(
        `select count(*) from pg_constraint
          where conrelid = 'public.tenants'::regclass
            and conname in ('tenants_cep_digits','tenants_uf',
              'tenants_document_digits','tenants_phone_digits');`,
      ),
    ).toBe(4);
  });

  it("insert legado (sem endereco, sem documento) continua valido", async () => {
    const id = await insertTenant({
      legal_name: "Legado SA",
      trade_name: "Legado",
      owner_email: `legado-${Date.now()}@example.invalid`,
      document: null,
      phone: null,
    });
    expect(id).not.toBe("");
  });

  it("documento mascarado e rejeitado pelo check", async () => {
    const { error } = await serviceClient().from("tenants").insert({
      legal_name: "Mascarada SA",
      owner_email: `masc-${Date.now()}@example.invalid`,
      document: "12.345.678/0001-90",
    });
    expect(error?.code).toBe("23514");
  });

  it("phone fora do formato e rejeitado pelo check", async () => {
    const { error } = await serviceClient().from("tenants").insert({
      legal_name: "Fone SA",
      owner_email: `fone-${Date.now()}@example.invalid`,
      phone: "11-9999",
    });
    expect(error?.code).toBe("23514");
  });

  it("cep e UF fora do formato sao rejeitados pelo check", async () => {
    const badCep = await serviceClient().from("tenants").insert({
      legal_name: "Cep SA",
      owner_email: `cep-${Date.now()}@example.invalid`,
      address_cep: "0131010X",
    });
    expect(badCep.error?.code).toBe("23514");

    const longCep = await serviceClient().from("tenants").insert({
      legal_name: "Cep Longo SA",
      owner_email: `ceplong-${Date.now()}@example.invalid`,
      address_cep: "01310-100",
    });
    expect(longCep.error?.code).toBe("23514");

    const badUf = await serviceClient().from("tenants").insert({
      legal_name: "Uf SA",
      owner_email: `uf-${Date.now()}@example.invalid`,
      address_state: "sp",
    });
    expect(badUf.error?.code).toBe("23514");
  });

  it("endereco completo valido e aceito", async () => {
    const id = await insertTenant({
      legal_name: "Completa SA",
      trade_name: "Completa",
      owner_email: `full-${Date.now()}@example.invalid`,
      document: fakeDocument(),
      phone: "11987654321",
      address_cep: "01310100",
      address_street: "Avenida Paulista",
      address_number: "1000",
      address_complement: null,
      address_city: "Sao Paulo",
      address_state: "SP",
    });
    expect(id).not.toBe("");
  });
});

describe("IT-02 RLS do endereco (ADR-001)", () => {
  let adminA: TestUser;
  let adminB: TestUser;
  let tenantA: string;
  let tenantB: string;

  beforeAll(async () => {
    adminA = await createCommonUser("rico-a");
    adminB = await createCommonUser("rico-b");
    tenantA = await tenantIdOf(adminA.id);
    tenantB = await tenantIdOf(adminB.id);

    const { error } = await serviceClient().from("tenants").update({
      address_cep: "01310100",
      address_street: "Avenida Paulista",
      address_number: "1000",
      address_city: "Sao Paulo",
      address_state: "SP",
    }).eq("id", tenantA);
    if (error) throw new Error(`Preparacao do endereco falhou (codigo ${error.code ?? "vazio"}).`);
  });

  it("proprio tenant le o endereco", async () => {
    const { data, error } = await adminA.client
      .from("tenants")
      .select("address_cep,address_city,address_state")
      .eq("id", tenantA);
    expect(error).toBeNull();
    expect(data ?? []).toHaveLength(1);
    expect(data?.[0]).toMatchObject({
      address_cep: "01310100",
      address_city: "Sao Paulo",
      address_state: "SP",
    });
  });

  it("cross-tenant negado: admin A nao le tenants da empresa B", async () => {
    const { data, error } = await adminA.client
      .from("tenants")
      .select("id,address_cep,address_city,address_state")
      .eq("id", tenantB);
    expect(error).toBeNull();
    expect(data ?? []).toHaveLength(0);
    expect(adminB.id).not.toBe("");
  });
});
