// Trigger handle_new_user (ADR-06): marcador de bootstrap só em app_metadata, cadastro comum
// inalterado e constraint de super admin sem tenant. Cobre CA-01 a CA-04 e CA-17.
//
// CA-01 é exercitado pelo INSERT direto em auth.users com o marcador em raw_app_meta_data, o
// mesmo caminho do script de operador (ADR-07). A Admin API grava o app_metadata depois do
// INSERT, então o trigger não o veria (ADR-07, P-12).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { anonClient, serviceClient } from "./helpers/clients.ts";
import { sql } from "./helpers/sql.ts";
import {
  createCommonUser,
  createSuperAdminUser,
  deleteTestUsers,
  freshPassword,
  readProfile,
  tenantIdOf,
  trackUser,
  uniqueEmail,
  type TestUser,
} from "./helpers/users.ts";

function countOf(query: string, vars: Record<string, string> = {}): number {
  return Number(sql(query, vars));
}

afterAll(async () => {
  await deleteTestUsers();
});

describe("CA-01 marcador de bootstrap cria só o super admin", () => {
  let tenantsBefore = 0;
  let templatesBefore = 0;

  beforeAll(() => {
    tenantsBefore = countOf("select count(*) from public.tenants;");
    templatesBefore = countOf("select count(*) from public.message_templates;");
  });

  it("cria profile super_admin sem tenant, com troca pendente, sem criar empresa", async () => {
    const superAdmin = await createSuperAdminUser("ca01");
    const profile = await readProfile(superAdmin.id);

    expect(profile.role).toBe("super_admin");
    expect(profile.tenant_id).toBeNull();
    expect(profile.must_change_password).toBe(true);
    expect(countOf("select count(*) from public.tenants;")).toBe(tenantsBefore);
    expect(countOf("select count(*) from public.message_templates;")).toBe(templatesBefore);
  });
});

describe("CA-02 cadastro comum continua igual", () => {
  it("signUp sem marcador cria empresa trial, profile admin e 5 mensagens da régua", async () => {
    const { data, error } = await anonClient().auth.signUp({
      email: uniqueEmail("ca02"),
      password: freshPassword(),
    });
    expect(error).toBeNull();
    const userId = data.user?.id;
    if (!userId) throw new Error("signUp não devolveu usuário");
    trackUser(userId);

    const profile = await readProfile(userId);
    expect(profile.role).toBe("admin");
    expect(profile.must_change_password).toBe(false);
    expect(profile.tenant_id).not.toBeNull();

    const tenantId = profile.tenant_id ?? "";
    expect(
      sql(`select subscription_status from public.tenants where id = :'tid';`, { tid: tenantId }),
    ).toBe("trial");
    expect(
      countOf(`select count(*) from public.message_templates where tenant_id = :'tid';`, {
        tid: tenantId,
      }),
    ).toBe(5);
  });
});

describe("CA-03 signUp não cria super admin com marcador em user_metadata", () => {
  it("bootstrap_role em options.data vira user_metadata e o papel fica admin", async () => {
    const { data, error } = await anonClient().auth.signUp({
      email: uniqueEmail("ca03"),
      password: freshPassword(),
      options: { data: { bootstrap_role: "super_admin" } },
    });
    expect(error).toBeNull();
    const userId = data.user?.id;
    if (!userId) throw new Error("signUp não devolveu usuário");
    trackUser(userId);

    const profile = await readProfile(userId);
    expect(profile.role).toBe("admin");
    expect(profile.tenant_id).not.toBeNull();
  });
});

describe("CA-04 cliente não altera o marcador de app_metadata", () => {
  it("updateUser com bootstrap_role não muda app_metadata nem o papel", async () => {
    const user: TestUser = await createCommonUser("ca04");
    const { error } = await user.client.auth.updateUser({
      data: { bootstrap_role: "super_admin" },
    });
    expect(error).toBeNull();

    const { data } = await serviceClient().auth.admin.getUserById(user.id);
    expect(data.user?.app_metadata?.bootstrap_role).toBeUndefined();
    expect((await readProfile(user.id)).role).toBe("admin");
  });
});

describe("CA-17 super admin não pode ter tenant", () => {
  it("atribuir tenant a um super admin é rejeitado pelo banco", async () => {
    const superAdmin = await createSuperAdminUser("ca17");
    const target = await createCommonUser("ca17-target");
    const tenantId = await tenantIdOf(target.id);

    expect(() =>
      sql(`update public.profiles set tenant_id = :'tid' where id = :'uid';`, {
        tid: tenantId,
        uid: superAdmin.id,
      }),
    ).toThrow(/profiles_super_admin_sem_tenant/);
  });
});
