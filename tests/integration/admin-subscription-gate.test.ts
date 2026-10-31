// Edge Function admin-subscription (ADR-09): super admin com troca pendente recebe 403
// password_change_required. Após a troca, o fluxo volta ao normal. Cobre CA-12 (escrita) e os
// critérios 1 a 4 da ADR-09.
import { afterAll, describe, expect, it } from "vitest";
import { serviceClient } from "./helpers/clients.ts";
import { callFunction } from "./helpers/functions.ts";
import { sql } from "./helpers/sql.ts";
import {
  completePasswordChange,
  createCommonUser,
  createSuperAdminUser,
  deleteTestUsers,
  tenantIdOf,
} from "./helpers/users.ts";

afterAll(async () => {
  await deleteTestUsers();
});

async function subscriptionStatusOf(tenantId: string): Promise<string> {
  const { data, error } = await serviceClient()
    .from("tenants")
    .select("subscription_status")
    .eq("id", tenantId)
    .single();
  if (error || !data) throw new Error(`Leitura do tenant falhou: ${error?.message ?? "vazio"}`);
  return data.subscription_status;
}

function auditRowsOf(tenantId: string): number {
  return Number(
    sql("select count(*) from public.subscription_status_changes where tenant_id = :'tid';", {
      tid: tenantId,
    }),
  );
}

describe("CA-12 e ADR-09 super admin com troca pendente não altera status", () => {
  it("403 password_change_required, sem mudar tenant nem trilha", async () => {
    const superAdmin = await createSuperAdminUser("sub-gate");
    const owner = await createCommonUser("sub-owner");
    const tenantId = await tenantIdOf(owner.id);
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

  it("após a troca, a mesma chamada segue o fluxo normal e responde 200", async () => {
    const superAdmin = await createSuperAdminUser("sub-after");
    const owner = await createCommonUser("sub-owner-after");
    const tenantId = await tenantIdOf(owner.id);

    await completePasswordChange(superAdmin.id);

    const response = await callFunction("admin-subscription", {
      token: superAdmin.accessToken,
      body: { action: "set_status", tenantId, status: "ativo" },
    });
    expect(response.status, response.text).toBe(200);
    expect(response.json).toMatchObject({ ok: true, tenant_id: tenantId, old_status: "trial", new_status: "ativo" });
    expect(await subscriptionStatusOf(tenantId)).toBe("ativo");
  });
});

describe("ADR-09 critérios de RBAC e autenticação preservados", () => {
  it("admin de tenant segue recusado (403) e o status não muda", async () => {
    const owner = await createCommonUser("sub-rbac-owner");
    const other = await createCommonUser("sub-rbac-other");
    const tenantId = await tenantIdOf(other.id);
    const statusBefore = await subscriptionStatusOf(tenantId);

    const response = await callFunction("admin-subscription", {
      token: owner.accessToken,
      body: { action: "set_status", tenantId, status: "ativo" },
    });
    expect(response.status).toBe(403);
    expect(response.json?.code).toBeUndefined();
    expect(await subscriptionStatusOf(tenantId)).toBe(statusBefore);
  });

  it("chamada sem JWT segue respondendo 401", async () => {
    const response = await callFunction("admin-subscription", {
      body: { action: "set_status", tenantId: "00000000-0000-0000-0000-000000000000", status: "ativo" },
    });
    expect(response.status).toBe(401);
  });
});
