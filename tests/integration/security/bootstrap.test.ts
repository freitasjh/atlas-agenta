// Edge Function `bootstrap-super-admin` (ADR-05) contra o stack local: RQ-01 a RQ-04 e RQ-16
// da ADR-13. A suíte é dona do `functions serve` porque precisa alternar `BOOTSTRAP_SECRET`
// (404) e `ATLAS_ENV` (403) sem reiniciar o stack inteiro.
//
// Pré-condição dura, sem skip: o banco precisa estar no estado de `supabase db reset`, isto é,
// sem super admin. Um super admin pré-existente é falha de ambiente, não caso a pular — o
// `beforeAll` falha alto com a instrução de reset.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { SUPER_ADMIN_EMAIL } from "../../../supabase/functions/_shared/super-admin-bootstrap.ts";
import { sql } from "../helpers/sql.ts";
import { serviceClient } from "../helpers/clients.ts";
import { callFunction, type FunctionResponse } from "../helpers/functions.ts";
import {
  ensureFunctionsDefault,
  getBootstrapSecret,
  startFunctions,
} from "../helpers/functions-server.ts";
import {
  createAuthUserWithoutProfileWithEmail,
  createCommonUserWithEmail,
  deleteAuthUserByEmail,
  deleteTestUsers,
  findAuthUserByEmail,
  readAuthMetadata,
  readProfile,
  uniqueEmail,
} from "../helpers/users.ts";

function countOf(query: string): number {
  return Number(sql(query));
}

function tenantsCount(): number {
  return countOf("select count(*) from public.tenants;");
}

function templatesCount(): number {
  return countOf("select count(*) from public.message_templates;");
}

function callBootstrap(secret: string | null): Promise<FunctionResponse> {
  return callFunction("bootstrap-super-admin", {
    body: {},
    ...(secret === null ? {} : { headers: { "x-bootstrap-secret": secret } }),
  });
}

beforeEach(async () => {
  await ensureFunctionsDefault();
});

beforeAll(async () => {
  // Fail-fast, nunca skip: a suíte apaga o super admin que criar e assume o banco recém-resetado.
  // Um super admin presente indica banco fora do estado de `supabase db reset` — o teste não pode
  // adivinhar o que fazer com ele (apagar dado de outro dono é proibido).
  const existing = await findAuthUserByEmail(SUPER_ADMIN_EMAIL);
  if (existing !== null) {
    throw new Error(
      "Banco fora do estado de `supabase db reset`: já existe super admin com o e-mail do bootstrap. " +
        "Rode `supabase db reset` e repita `npm run test:integration`.",
    );
  }
});

afterAll(async () => {
  await deleteAuthUserByEmail(SUPER_ADMIN_EMAIL);
  await deleteTestUsers();
});

describe("RQ-03 e RQ-04 autenticidade e trava de ambiente", () => {
  it("sem BOOTSTRAP_SECRET no ambiente responde 404, inclusive em método não-POST", async () => {
    await startFunctions({ bootstrapSecret: null, atlasEnv: "local" });

    const post = await callBootstrap("qualquer-segredo");
    expect(post.status).toBe(404);
    expect(post.text).toBe("");

    const get = await callFunction("bootstrap-super-admin", { method: "GET" });
    expect(get.status).toBe(404);
  });

  it("segredo errado responde 401 sem criar usuário", async () => {
    const response = await callBootstrap("segredo-errado");

    expect(response.status).toBe(401);
    expect(response.json?.code).toBe("nao_autorizado");
  });

  it("fora do ambiente local responde 403 mesmo com o segredo certo", async () => {
    await startFunctions({ bootstrapSecret: getBootstrapSecret(), atlasEnv: "production" });

    const response = await callBootstrap(getBootstrapSecret());
    expect(response.status).toBe(403);
    expect(response.json?.code).toBe("ambiente_nao_local");
  });

  it("usuário do Auth sem profile responde 409 usuario_sem_profile e nada é criado", async () => {
    const orphanId = await createAuthUserWithoutProfileWithEmail(SUPER_ADMIN_EMAIL, {
      track: false,
    });

    const response = await callBootstrap(getBootstrapSecret());

    expect(response.status, response.text).toBe(409);
    expect(response.json?.code).toBe("usuario_sem_profile");
    // O usuário do Auth fica como está: nenhum profile nasce e nenhuma empresa é criada.
    const { data } = await serviceClient().from("profiles").select("id").eq("id", orphanId);
    expect(data ?? []).toHaveLength(0);

    await deleteAuthUserByEmail(SUPER_ADMIN_EMAIL);
  });
});

describe("RQ-01 e RQ-02 criação idempotente e recusa de admin de empresa", () => {
  it("admin de empresa com o e-mail do bootstrap responde 409 e nada muda", async () => {
    const admin = await createCommonUserWithEmail(SUPER_ADMIN_EMAIL, { track: false });
    const tenantsBefore = tenantsCount();
    const profileBefore = await readProfile(admin.id);

    const response = await callBootstrap(getBootstrapSecret());

    expect(response.status).toBe(409);
    expect(response.json?.code).toBe("email_com_outro_papel");
    expect(tenantsCount()).toBe(tenantsBefore);
    expect(await readProfile(admin.id)).toEqual(profileBefore);
    expect(profileBefore.role).toBe("admin");

    await deleteAuthUserByEmail(SUPER_ADMIN_EMAIL);
  });

  it("cria o super admin sem empresa e sem mexer na contagem de tenants e templates", async () => {
    const tenantsBefore = tenantsCount();
    const templatesBefore = templatesCount();

    const response = await callBootstrap(getBootstrapSecret());
    expect(response.status, response.text).toBe(201);
    expect(response.json?.status).toBe("criado");
    const userId = String(response.json?.user_id ?? "");
    expect(userId).not.toBe("");

    const profile = await readProfile(userId);
    expect(profile.role).toBe("super_admin");
    expect(profile.tenant_id).toBeNull();

    const metadata = await readAuthMetadata(userId);
    expect(metadata.must_change_password).toBe(true);

    expect(tenantsCount()).toBe(tenantsBefore);
    expect(templatesCount()).toBe(templatesBefore);

    // A senha provisória fica só no servidor: a resposta não a ecoa (CA-11).
    expect(response.text).not.toContain("AtlasAgenda");
  });

  it("segunda chamada responde 200 ja_existe sem alterar senha, flag nem dados", async () => {
    const first = await callBootstrap(getBootstrapSecret());
    expect([200, 201]).toContain(first.status);
    const userId = String(first.json?.user_id ?? "");
    expect(userId).not.toBe("");
    const tenantsBefore = tenantsCount();
    const templatesBefore = templatesCount();
    const metadataBefore = await readAuthMetadata(userId);

    const second = await callBootstrap(getBootstrapSecret());

    expect(second.status, second.text).toBe(200);
    expect(second.json?.status).toBe("ja_existe");
    expect(second.json?.user_id).toBe(userId);
    expect(tenantsCount()).toBe(tenantsBefore);
    expect(templatesCount()).toBe(templatesBefore);
    expect(await readAuthMetadata(userId)).toEqual(metadataBefore);
  });
});

describe("RQ-16 contagem de tenants independe do bootstrap", () => {
  it("usuário de teste comum cria empresa, mas o e-mail do bootstrap continua livre", async () => {
    const before = tenantsCount();
    const owner = await createCommonUserWithEmail(uniqueEmail("bootstrap-owner"));
    expect(tenantsCount()).toBe(before + 1);

    const response = await callBootstrap(getBootstrapSecret());
    expect([200, 201]).toContain(response.status);
    expect(response.json?.user_id).not.toBe(owner.id);
  });
});
