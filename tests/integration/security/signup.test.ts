// Edge Function `signup-tenant` (ADR-02) contra o stack local: RQ-19 da ADR-13.
// Cadastro cria empresa, profile `admin` e os 5 templates na mesma transação da RPC; falha forçada
// na RPC não deixa empresa nem usuário Auth.
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

beforeAll(async () => {
  await ensureFunctionsDefault();
});

afterAll(async () => {
  await deleteTestUsers();
});

describe("RQ-19 cadastro cria empresa, admin e templates", () => {
  it("responde 201 e cria empresa trial, profile admin e 5 templates", async () => {
    const email = uniqueEmail("signup");
    const password = freshPassword();
    const tradeName = `Clinica Teste ${email.slice(0, 8)}`;

    const response = await callFunction("signup-tenant", {
      body: {
        email,
        password,
        trade_name: tradeName,
        full_name: "Dono da Empresa",
        segment: "clinica",
      },
    });
    expect(response.status, response.text).toBe(201);
    expect(response.json).toEqual({ ok: true });

    const tenantResult = await serviceClient()
      .from("tenants")
      .select("id, subscription_status, segment")
      .eq("owner_email", email)
      .single();
    if (tenantResult.error || !tenantResult.data) {
      throw new Error("Empresa criada pelo cadastro não encontrada.");
    }
    const tenant = tenantResult.data;
    trackTenant(tenant.id);

    expect(tenant.subscription_status).toBe("trial");
    expect(tenant.segment).toBe("clinica");

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

describe("RQ-19 falha forçada na RPC não deixa resíduo", () => {
  it("responde 500 cadastro_falhou e remove o usuário Auth recém-criado", async () => {
    const email = uniqueEmail("signup-fail");

    sql(
      "revoke execute on function public.create_tenant_with_admin(uuid, text, text, text, text) from service_role;",
    );
    try {
      const response = await callFunction("signup-tenant", {
        body: {
          email,
          password: freshPassword(),
          trade_name: "Empresa que falha",
          segment: "barbearia",
        },
      });

      expect(response.status).toBe(500);
      expect(response.json?.code).toBe("cadastro_falhou");
    } finally {
      sql(
        "grant execute on function public.create_tenant_with_admin(uuid, text, text, text, text) to service_role;",
      );
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
