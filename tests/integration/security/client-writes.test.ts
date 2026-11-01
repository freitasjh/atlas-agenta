// Escritas do cliente autenticado em `profiles` e `app_metadata` (RQ-13 da ADR-13, ADR-12).
// A migração de limpeza revogou toda a escrita de `anon`/`authenticated` em `profiles` e removeu
// a policy de UPDATE do próprio perfil. Cada tentativa abaixo tem de terminar sem alterar nada.
//
// A cobertura é por PAPEL, não só pelo dono da empresa: `admin`, `professional`, `receptionist` e
// `super_admin` compartilham o mesmo role de JWT (`authenticated`), então todos precisam passar
// pelas mesmas tentativas — um grant ou policy que voltasse a valer para `authenticated` abriria
// escrita para os quatro de uma vez.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { serviceClient } from "../helpers/clients.ts";
import { ensureFunctionsDefault } from "../helpers/functions-server.ts";
import {
  createAuthUserWithoutProfile,
  createCommonUser,
  createSuperAdminUser,
  createTenantMember,
  deleteTestUsers,
  readAuthMetadata,
  readProfile,
  tenantIdOf,
  type TestUser,
} from "../helpers/users.ts";

/** Papéis de `profiles` cobertos pela RQ-13. */
const ROLES = ["admin", "professional", "receptionist", "super_admin"] as const;
type Role = (typeof ROLES)[number];

interface RoleSession {
  role: Role;
  user: TestUser;
  /** `null` só para `super_admin` (invariante do banco). */
  tenantId: string | null;
}

const sessions = new Map<Role, RoleSession>();

function sessionOf(role: Role): RoleSession {
  const session = sessions.get(role);
  if (!session) throw new Error(`Sessão do papel ${role} não foi criada.`);
  return session;
}

/** Papel diferente do atual; para `super_admin` o alvo precisa de empresa. */
function otherRole(role: Role): Role {
  return role === "super_admin" ? "admin" : "super_admin";
}

beforeAll(async () => {
  await ensureFunctionsDefault();

  // O dono da empresa nasce pelo cadastro; os demais papéis entram por INSERT server-side.
  const admin = await createCommonUser("client-writes-admin");
  const tenantId = await tenantIdOf(admin.id);
  sessions.set("admin", { role: "admin", user: admin, tenantId });
  sessions.set("professional", {
    role: "professional",
    user: await createTenantMember(tenantId, "professional", "client-writes-professional"),
    tenantId,
  });
  sessions.set("receptionist", {
    role: "receptionist",
    user: await createTenantMember(tenantId, "receptionist", "client-writes-receptionist"),
    tenantId,
  });
  sessions.set("super_admin", {
    role: "super_admin",
    user: await createSuperAdminUser("client-writes-super"),
    tenantId: null,
  });
});

afterAll(async () => {
  await deleteTestUsers();
});

function expectNoWrite(
  result: { error: { code?: string; message?: string } | null; data: unknown[] | null },
  label: string,
): void {
  const wrote = (result.data ?? []).length > 0;
  expect(wrote, `${label}: nenhuma linha pode ser gravada`).toBe(false);
  if (result.error) {
    expect(result.error.code, `${label}: erro de permissão`).toBe("42501");
  }
}

describe("RQ-13 cliente não altera colunas de profiles", () => {
  for (const role of ROLES) {
    it(`${role}: update de role, tenant_id e id não altera a linha`, async () => {
      const { user, tenantId } = sessionOf(role);
      const before = await readProfile(user.id);

      // `id` e `tenant_id` novos são sempre UUIDs aleatórios: nenhum coincide com o estado atual.
      const patches: Array<Record<string, string>> = [
        { role: otherRole(role) },
        { tenant_id: randomUUID() },
        { id: randomUUID() },
      ];

      for (const patch of patches) {
        const result = await user.client
          .from("profiles")
          .update(patch)
          .eq("id", user.id)
          .select("id");
        expectNoWrite(result, `${role} update ${Object.keys(patch).join(",")}`);
      }

      expect(await readProfile(user.id)).toEqual(before);
      expect(before.role).toBe(role);
      expect(before.tenant_id).toBe(tenantId);
    });

    it(`${role}: insert de profile pela sessão autenticada é negado e não cria linha`, async () => {
      const { user, tenantId } = sessionOf(role);
      const orphanId = await createAuthUserWithoutProfile(`client-writes-orphan-${role}`);

      const result = await user.client
        .from("profiles")
        .insert({ id: orphanId, tenant_id: tenantId, role })
        .select("id");
      expectNoWrite(result, `${role} insert`);

      const { data } = await serviceClient().from("profiles").select("id").eq("id", orphanId);
      expect(data ?? []).toHaveLength(0);
    });

    it(`${role}: delete do próprio profile não remove a linha`, async () => {
      const { user } = sessionOf(role);
      const before = await readProfile(user.id);

      const result = await user.client.from("profiles").delete().eq("id", user.id).select("id");
      expectNoWrite(result, `${role} delete`);

      expect(await readProfile(user.id)).toEqual(before);
    });
  }
});

describe("RQ-13 cliente não altera app_metadata", () => {
  for (const role of ROLES) {
    it(`${role}: updateUser com app_metadata no payload grava só user_metadata`, async () => {
      const { user } = sessionOf(role);
      const before = await readAuthMetadata(user.id);
      const profileBefore = await readProfile(user.id);

      const { error } = await user.client.auth.updateUser({
        data: { app_metadata: { must_change_password: false, user_role: "super_admin" } },
      });
      expect(error).toBeNull();

      // `app_metadata` é o campo privilegiado (fonte do flag desde a ADR-04): nada muda nele.
      expect(await readAuthMetadata(user.id)).toEqual(before);
      expect(await readProfile(user.id)).toEqual(profileBefore);
    });
  }
});
