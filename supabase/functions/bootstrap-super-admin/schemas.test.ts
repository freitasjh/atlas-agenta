// Testes da Edge Function `bootstrap-super-admin` (ADR-05). Rodar com:
//   deno test --allow-env supabase/functions/bootstrap-super-admin/
//
// Cobrem a decisão pura compartilhada (`decideBootstrapAction`), a autenticação por segredo em
// tempo constante e a trava de ambiente. O fluxo com banco é coberto pela suíte de integração.
import { deepStrictEqual, strictEqual } from "node:assert/strict";
import {
  authorizeBootstrapRequest,
  isLocalEnvironment,
  parseBootstrapProfile,
  secretsMatch,
} from "./schemas.ts";
import { decideBootstrapAction } from "../_shared/super-admin-bootstrap.ts";

const SECRET = "segredo-de-teste-adr05";

Deno.test("sem usuário resulta em criado", () => {
  strictEqual(decideBootstrapAction({ exists: false }), "criado");
});

Deno.test("super admin sem tenant resulta em ja_existe", () => {
  strictEqual(
    decideBootstrapAction({ exists: true, profileRole: "super_admin", tenantId: null }),
    "ja_existe",
  );
});

Deno.test("admin de empresa resulta em recusa_papel", () => {
  strictEqual(
    decideBootstrapAction({ exists: true, profileRole: "admin", tenantId: "t-1" }),
    "recusa_papel",
  );
});

Deno.test("usuário sem profile resulta em recusa_papel", () => {
  strictEqual(
    decideBootstrapAction({ exists: true, profileRole: null, tenantId: null }),
    "recusa_papel",
  );
});

Deno.test("super admin com tenant preenchido resulta em recusa_papel", () => {
  strictEqual(
    decideBootstrapAction({ exists: true, profileRole: "super_admin", tenantId: "t-1" }),
    "recusa_papel",
  );
});

Deno.test("professional de empresa resulta em recusa_papel", () => {
  strictEqual(
    decideBootstrapAction({ exists: true, profileRole: "professional", tenantId: "t-1" }),
    "recusa_papel",
  );
});

Deno.test("segredos iguais casam", async () => {
  strictEqual(await secretsMatch(SECRET, SECRET), true);
  strictEqual(await secretsMatch("", ""), true);
});

Deno.test("segredos diferentes não casam, inclusive prefixo e tamanho", async () => {
  strictEqual(await secretsMatch(SECRET, `${SECRET}-outro`), false);
  strictEqual(await secretsMatch(SECRET.slice(0, 5), SECRET), false);
  strictEqual(await secretsMatch("", SECRET), false);
});

Deno.test("BOOTSTRAP_SECRET ausente na função responde 404", async () => {
  deepStrictEqual(
    await authorizeBootstrapRequest({
      presentedSecret: SECRET,
      expectedSecret: undefined,
      atlasEnv: "local",
      allowNonLocal: "true",
    }),
    { ok: false, status: 404, code: "nao_encontrado" },
  );
});

Deno.test("segredo errado responde 401", async () => {
  deepStrictEqual(
    await authorizeBootstrapRequest({
      presentedSecret: "errado",
      expectedSecret: SECRET,
      atlasEnv: "local",
      allowNonLocal: undefined,
    }),
    { ok: false, status: 401, code: "nao_autorizado" },
  );
});

Deno.test("header de segredo ausente responde 401 mesmo com ambiente local", async () => {
  deepStrictEqual(
    await authorizeBootstrapRequest({
      presentedSecret: null,
      expectedSecret: SECRET,
      atlasEnv: "local",
      allowNonLocal: undefined,
    }),
    { ok: false, status: 401, code: "nao_autorizado" },
  );
});

Deno.test("401 vem antes da trava de ambiente", async () => {
  deepStrictEqual(
    await authorizeBootstrapRequest({
      presentedSecret: "errado",
      expectedSecret: SECRET,
      atlasEnv: "production",
      allowNonLocal: undefined,
    }),
    { ok: false, status: 401, code: "nao_autorizado" },
  );
});

Deno.test("ambiente não local com segredo certo responde 403", async () => {
  deepStrictEqual(
    await authorizeBootstrapRequest({
      presentedSecret: SECRET,
      expectedSecret: SECRET,
      atlasEnv: "staging",
      allowNonLocal: undefined,
    }),
    { ok: false, status: 403, code: "ambiente_nao_local" },
  );
});

Deno.test("ATLAS_ENV ausente responde 403 (falha fechada)", async () => {
  deepStrictEqual(
    await authorizeBootstrapRequest({
      presentedSecret: SECRET,
      expectedSecret: SECRET,
      atlasEnv: undefined,
      allowNonLocal: undefined,
    }),
    { ok: false, status: 403, code: "ambiente_nao_local" },
  );
});

Deno.test("ambiente local com segredo certo libera", async () => {
  deepStrictEqual(
    await authorizeBootstrapRequest({
      presentedSecret: SECRET,
      expectedSecret: SECRET,
      atlasEnv: "local",
      allowNonLocal: undefined,
    }),
    { ok: true },
  );
});

Deno.test("BOOTSTRAP_ALLOW_NON_LOCAL=true libera ambiente remoto", async () => {
  deepStrictEqual(
    await authorizeBootstrapRequest({
      presentedSecret: SECRET,
      expectedSecret: SECRET,
      atlasEnv: "staging",
      allowNonLocal: "true",
    }),
    { ok: true },
  );
});

Deno.test("BOOTSTRAP_ALLOW_NON_LOCAL com outro valor não libera", async () => {
  strictEqual(isLocalEnvironment("staging", "1"), false);
  strictEqual(isLocalEnvironment("staging", "TRUE"), false);
  strictEqual(isLocalEnvironment("local", undefined), true);
});

Deno.test("profile do banco é validado antes do uso", () => {
  deepStrictEqual(parseBootstrapProfile({ role: "super_admin", tenant_id: null }), {
    role: "super_admin",
    tenantId: null,
  });
  deepStrictEqual(parseBootstrapProfile({ role: null, tenant_id: null }), {
    role: null,
    tenantId: null,
  });
  strictEqual(parseBootstrapProfile({ role: 1, tenant_id: null }), null);
  strictEqual(parseBootstrapProfile({ role: "super_admin" }), null);
  strictEqual(parseBootstrapProfile(null), null);
});
