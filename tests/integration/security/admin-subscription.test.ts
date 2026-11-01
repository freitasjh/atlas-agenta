// Edge Function `admin-subscription` (ADR-06) contra o stack local: RQ-18 da ADR-13.
// Super admin com a flag de troca ligada recebe 403 `password_change_required` antes de qualquer
// escrita; depois de limpar a flag, a mesma chamada segue o fluxo normal.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { serviceClient } from "../helpers/clients.ts";
import { callFunction } from "../helpers/functions.ts";
import { ensureFunctionsDefault } from "../helpers/functions-server.ts";
import { sql } from "../helpers/sql.ts";
import {
  clearMustChangePassword,
  createCommonUser,
  createSuperAdminUser,
  deleteTestUsers,
  tenantIdOf,
  type TestUser,
} from "../helpers/users.ts";

let superAdmin: TestUser;
let owner: TestUser;
let tenantId: string;

async function subscriptionStatusOf(id: string): Promise<string> {
  const { data, error } = await serviceClient()
    .from("tenants")
    .select("subscription_status")
    .eq("id", id)
    .single();
  if (error || !data) throw new Error("Leitura do tenant falhou.");
  return data.subscription_status;
}

function auditRowsOf(id: string): number {
  return Number(
    sql("select count(*) from public.subscription_status_changes where tenant_id = :'tid';", {
      tid: id,
    }),
  );
}

beforeAll(async () => {
  await ensureFunctionsDefault();
  superAdmin = await createSuperAdminUser("sub-gate");
  owner = await createCommonUser("sub-owner");
  tenantId = await tenantIdOf(owner.id);
});

afterAll(async () => {
  await deleteTestUsers();
});

describe("RQ-18 super admin com troca pendente não altera status", () => {
  it("403 password_change_required, sem mudar tenant nem trilha", async () => {
    const statusBefore = await subscriptionStatusOf(tenantId);
    const auditBefore = auditRowsOf(tenantId);

    const response = await callFunction("admin-subscription", {
      token: superAdmin.accessToken,
      body: { action: "set_status", tenantId, status: "ativo" },
    });

    expect(response.status).toBe(403);
    expect(response.json?.code).toBe("password_change_required");
    expect(response.json?.error).toBe("Troque sua senha antes de operar o painel.");
    expect(await subscriptionStatusOf(tenantId)).toBe(statusBefore);
    expect(auditRowsOf(tenantId)).toBe(auditBefore);
  });

  it("com a flag limpa, a mesma chamada responde 200 e grava a trilha", async () => {
    await clearMustChangePassword(superAdmin.id);
    const auditBefore = auditRowsOf(tenantId);

    const response = await callFunction("admin-subscription", {
      token: superAdmin.accessToken,
      body: { action: "set_status", tenantId, status: "ativo" },
    });

    expect(response.status, response.text).toBe(200);
    expect(response.json).toMatchObject({
      ok: true,
      tenant_id: tenantId,
      old_status: "trial",
      new_status: "ativo",
    });
    expect(await subscriptionStatusOf(tenantId)).toBe("ativo");
    expect(auditRowsOf(tenantId)).toBe(auditBefore + 1);
  });
});

describe("RQ-18 RBAC e autenticação preservados", () => {
  it("admin da empresa segue recusado (403) e o status não muda", async () => {
    const other = await createCommonUser("sub-rbac-other");
    const otherTenant = await tenantIdOf(other.id);
    const statusBefore = await subscriptionStatusOf(otherTenant);

    const response = await callFunction("admin-subscription", {
      token: owner.accessToken,
      body: { action: "set_status", tenantId: otherTenant, status: "ativo" },
    });

    expect(response.status).toBe(403);
    expect(await subscriptionStatusOf(otherTenant)).toBe(statusBefore);
  });

  it("chamada sem JWT responde 401", async () => {
    const response = await callFunction("admin-subscription", {
      body: {
        action: "set_status",
        tenantId: "00000000-0000-0000-0000-000000000000",
        status: "ativo",
      },
    });
    expect(response.status).toBe(401);
  });
});
