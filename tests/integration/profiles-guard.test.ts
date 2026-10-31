// Guard de colunas privilegiadas de `profiles` (ADR-02, ADR-01) e RLS sem policy de insert/delete.
// Cobre CA-05, CA-06 e RQ-11.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { serviceClient } from "./helpers/clients.ts";
import {
  createCommonUser,
  createSuperAdminUser,
  deleteTestUsers,
  readProfile,
  type TestUser,
} from "./helpers/users.ts";

let superAdmin: TestUser;
let admin: TestUser;
let professional: TestUser;

beforeAll(async () => {
  superAdmin = await createSuperAdminUser();
  admin = await createCommonUser("guard-admin");
  professional = await createCommonUser("guard-pro");
  // Papel `professional` é ligado pela service role; o cadastro comum só cria `admin`.
  const { error } = await serviceClient()
    .from("profiles")
    .update({ role: "professional" })
    .eq("id", professional.id);
  if (error) throw new Error(`Preparação do profissional falhou: ${error.message}`);
});

afterAll(async () => {
  await deleteTestUsers();
});

describe("CA-05 cliente não altera colunas privilegiadas de profiles", () => {
  const cases: Array<{ papel: string; user: () => TestUser }> = [
    { papel: "super_admin", user: () => superAdmin },
    { papel: "admin", user: () => admin },
    { papel: "professional", user: () => professional },
  ];

  for (const { papel, user } of cases) {
    it(`sessão de ${papel} não altera flag, datas, papel nem tenant`, async () => {
      const target = user();
      const before = await readProfile(target.id);

      // Cada tentativa muda o valor de fato: o guard só barra mudança real (IS DISTINCT FROM).
      const otherRole = before.role === "super_admin" ? "admin" : "super_admin";
      const attempts = [
        { must_change_password: !before.must_change_password },
        { password_changed_at: new Date().toISOString() },
        { role: otherRole },
        { tenant_id: randomUUID() },
      ];
      for (const patch of attempts) {
        const { error } = await target.client.from("profiles").update(patch).eq("id", target.id);
        expect(error?.message ?? "", `patch ${JSON.stringify(patch)}`).toContain(
          "privileged_column_change_denied",
        );
      }

      const after = await readProfile(target.id);
      expect(after).toEqual(before);
    });
  }
});

describe("CA-06 cliente não cria nem apaga profile", () => {
  it("insert por sessão autenticada é negado", async () => {
    const { error } = await admin.client.from("profiles").insert({
      id: randomUUID(),
      role: "admin",
      tenant_id: null,
    });
    expect(error).not.toBeNull();
  });

  it("delete do próprio profile por sessão autenticada não remove a linha", async () => {
    const { data } = await professional.client
      .from("profiles")
      .delete()
      .eq("id", professional.id)
      .select("id");
    expect(data ?? []).toHaveLength(0);

    const still = await readProfile(professional.id);
    expect(still.role).toBe("professional");
  });
});
