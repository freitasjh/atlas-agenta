// Edge Function `signup-tenant` (ADR-002 cadastro rico) contra o stack local.
// Cadastro cria empresa, profile `admin` e os 5 templates na mesma transação da RPC; falha forçada
// na RPC não deixa empresa nem usuário Auth. Duplicado de documento → 409 sem ecoar PII.
// Nenhum valor de documento/telefone/e-mail é impresso aqui.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { serviceClient } from "../helpers/clients.ts";
import { callFunction } from "../helpers/functions.ts";
import { ensureFunctionsDefault } from "../helpers/functions-server.ts";
import { sql } from "../helpers/sql.ts";
import {
  deleteTestUsers,
  findAuthUserByEmail,
  freshPassword,
  trackTenant,
  trackUser,
  uniqueEmail,
} from "../helpers/users.ts";

const TEMPLATE_KEYS = [
  "confirmacao",
  "lembrete_d1",
  "cobranca",
  "comprovante",
  "reagendar_retorno",
];

/** Assinatura de 14 params da RPC (pós ADR-002). */
const RPC_14 =
  "public.create_tenant_with_admin(uuid, text, text, text, text, text, text, text, text, text, text, text, text, text)";

let cpfCounter = 0;

/** CPF válido e único por chamada (base de timestamp + DVs calculados). */
function uniqueValidCpf(): string {
  cpfCounter += 1;
  const base = `${Date.now() % 1_000_000_000}${cpfCounter}`.replace(/[^0-9]/g, "").padStart(9, "3").slice(-9);
  const digit = (s: string, weight: number): number => {
    let sum = 0;
    for (let i = 0; i < s.length; i += 1) sum += Number(s[i]) * (weight - i);
    const rem = sum % 11;
    return rem < 2 ? 0 : 11 - rem;
  };
  const d1 = digit(base, 10);
  const d2 = digit(`${base}${d1}`, 11);
  return `${base}${d1}${d2}`;
}

function validSignupBody(email: string, document: string) {
  return {
    email,
    password: freshPassword(),
    trade_name: `Clinica Teste ${email.slice(0, 8)}`,
    legal_name: "Clinica Teste LTDA",
    document,
    phone_empresa: "(11) 98765-4321",
    address_cep: "01310-100",
    address_street: "Avenida Paulista",
    address_number: "1000",
    address_city: "Sao Paulo",
    address_state: "sp",
    full_name: "Dono da Empresa",
    segment: "clinica",
  };
}

beforeAll(async () => {
  await ensureFunctionsDefault();
});

afterAll(async () => {
  await deleteTestUsers();
});

describe("RQ-19 cadastro cria empresa, admin e templates", () => {
  it("responde 201 { tenant_id } e cria empresa trial, profile admin e 5 templates", async () => {
    const email = uniqueEmail("signup");
    const document = uniqueValidCpf();

    const response = await callFunction("signup-tenant", {
      body: validSignupBody(email, document),
    });
    expect(response.status, response.text).toBe(201);
    expect(typeof response.json?.tenant_id).toBe("string");
    const tenantId = response.json?.tenant_id as string;
    trackTenant(tenantId);

    const tenantResult = await serviceClient()
      .from("tenants")
      .select("id, subscription_status, segment, document, phone, legal_name, address_cep, address_state")
      .eq("id", tenantId)
      .single();
    if (tenantResult.error || !tenantResult.data) {
      throw new Error("Empresa criada pelo cadastro não encontrada.");
    }
    const tenant = tenantResult.data;

    expect(tenant.subscription_status).toBe("trial");
    expect(tenant.segment).toBe("clinica");
    expect(tenant.document).toBe(document);
    expect(tenant.phone).toBe("11987654321");
    expect(tenant.address_cep).toBe("01310100");
    expect(tenant.address_state).toBe("SP");

    const profileResult = await serviceClient()
      .from("profiles")
      .select("role, tenant_id, full_name")
      .eq("tenant_id", tenant.id)
      .single();
    if (profileResult.error || !profileResult.data) {
      throw new Error("Profile criado pelo cadastro não encontrado.");
    }
    expect(profileResult.data.role).toBe("admin");
    expect(profileResult.data.full_name).toBe("Dono da Empresa");

    const templates = await serviceClient()
      .from("message_templates")
      .select("template_key")
      .eq("tenant_id", tenant.id);
    expect(templates.error).toBeNull();
    const keys = ((templates.data ?? []) as Array<{ template_key: string }>).map(
      (row) => row.template_key,
    );
    expect(keys.sort()).toEqual([...TEMPLATE_KEYS].sort());

    const authUser = await findAuthUserByEmail(email);
    expect(authUser).not.toBeNull();
    if (authUser) trackUser(authUser.id);
  });
});

describe("cadastro rico valida documento e endereço", () => {
  it("documento duplicado responde 409 sem ecoar o valor", async () => {
    const document = uniqueValidCpf();
    const firstEmail = uniqueEmail("signup-dup-a");
    const first = await callFunction("signup-tenant", {
      body: validSignupBody(firstEmail, document),
    });
    expect(first.status, first.text).toBe(201);
    if (typeof first.json?.tenant_id === "string") trackTenant(first.json.tenant_id);
    const firstUser = await findAuthUserByEmail(firstEmail);
    if (firstUser) trackUser(firstUser.id);

    const secondEmail = uniqueEmail("signup-dup-b");
    const second = await callFunction("signup-tenant", {
      body: validSignupBody(secondEmail, document),
    });
    expect(second.status, second.text).toBe(409);
    expect(second.json).toEqual({
      code: "document_ja_cadastrado",
      message: "Este CNPJ/CPF já tem cadastro.",
    });
    expect(second.text).not.toContain(document);

    const secondUser = await findAuthUserByEmail(secondEmail);
    expect(secondUser).toBeNull();
  });

  it("documento com DV errado responde 400 document_invalido", async () => {
    const response = await callFunction("signup-tenant", {
      body: validSignupBody(uniqueEmail("signup-doc"), "52998224726"),
    });
    expect(response.status, response.text).toBe(400);
    expect(response.json).toEqual({ code: "document_invalido", message: "CNPJ/CPF inválido." });
  });

  it("campo extra responde 400 invalid_body", async () => {
    const response = await callFunction("signup-tenant", {
      body: { ...validSignupBody(uniqueEmail("signup-extra"), uniqueValidCpf()), whatsapp: "11999999999" },
    });
    expect(response.status, response.text).toBe(400);
    expect(response.json?.code).toBe("invalid_body");
  });

  it("nome do admin vazio responde 400 nome_admin_obrigatorio", async () => {
    const response = await callFunction("signup-tenant", {
      body: { ...validSignupBody(uniqueEmail("signup-nome"), uniqueValidCpf()), full_name: "  " },
    });
    expect(response.status, response.text).toBe(400);
    expect(response.json).toEqual({ code: "nome_admin_obrigatorio", message: "Informe seu nome." });
  });

  it("endereço incompleto responde 400 endereco_incompleto", async () => {
    const body = validSignupBody(uniqueEmail("signup-end"), uniqueValidCpf());
    const { address_city: _city, ...noCity } = body;
    const response = await callFunction("signup-tenant", { body: noCity });
    expect(response.status, response.text).toBe(400);
    expect(response.json?.code).toBe("endereco_incompleto");
  });
});

describe("RQ-19 falha forçada na RPC não deixa resíduo", () => {
  it("responde 500 cadastro_falhou e remove o usuário Auth recém-criado", async () => {
    const email = uniqueEmail("signup-fail");

    sql(`revoke execute on function ${RPC_14} from service_role;`);
    try {
      const response = await callFunction("signup-tenant", {
        body: validSignupBody(email, uniqueValidCpf()),
      });

      expect(response.status).toBe(500);
      expect(response.json?.code).toBe("cadastro_falhou");
    } finally {
      sql(`grant execute on function ${RPC_14} to service_role;`);
    }

    expect(await findAuthUserByEmail(email)).toBeNull();
    const { count, error } = await serviceClient()
      .from("tenants")
      .select("id", { count: "exact", head: true })
      .eq("owner_email", email);
    expect(error).toBeNull();
    expect(count ?? 0).toBe(0);
  });
});

describe("RPC barra documento ruim em chamada direta", () => {
  it("só 1 assinatura no catálogo e EXECUTE negado para anon/authenticated", () => {
    expect(
      sql(
        `select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname = 'create_tenant_with_admin';`,
      ),
    ).toBe("1");
    expect(
      sql(
        `select count(*) from information_schema.routine_privileges
          where routine_schema = 'public' and routine_name = 'create_tenant_with_admin'
            and grantee in ('anon', 'authenticated');`,
      ),
    ).toBe("0");
  });
});
