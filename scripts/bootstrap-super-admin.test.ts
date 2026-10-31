// Testes unitários do bootstrap do super admin (ADR-07). Rodar com: deno test scripts/bootstrap-super-admin.test.ts
import { strictEqual, notStrictEqual } from "node:assert/strict";
import {
  BOOTSTRAP_ROLE_KEY,
  BOOTSTRAP_ROLE_VALUE,
  PROVISIONAL_PASSWORD,
  decideBootstrapAction,
} from "../supabase/functions/_shared/super-admin-bootstrap.ts";
import { isLocalUrl, shouldBlockRemote } from "./bootstrap-super-admin.ts";

Deno.test("usuário inexistente resulta em criado", () => {
  strictEqual(decideBootstrapAction({ exists: false }), "criado");
});

Deno.test("super admin sem tenant resulta em ja_existe", () => {
  strictEqual(
    decideBootstrapAction({ exists: true, profileRole: "super_admin", tenantId: null }),
    "ja_existe",
  );
});

Deno.test("admin de tenant resulta em recusa_papel", () => {
  strictEqual(
    decideBootstrapAction({ exists: true, profileRole: "admin", tenantId: "t-1" }),
    "recusa_papel",
  );
});

Deno.test("super admin com tenant preenchido resulta em recusa_papel", () => {
  strictEqual(
    decideBootstrapAction({ exists: true, profileRole: "super_admin", tenantId: "t-1" }),
    "recusa_papel",
  );
});

Deno.test("usuário sem profile resulta em recusa_papel", () => {
  strictEqual(
    decideBootstrapAction({ exists: true, profileRole: null, tenantId: null }),
    "recusa_papel",
  );
});

Deno.test("URLs locais não são bloqueadas", () => {
  strictEqual(isLocalUrl("http://127.0.0.1:54321"), true);
  strictEqual(isLocalUrl("http://localhost:54321"), true);
  strictEqual(shouldBlockRemote("http://127.0.0.1:54321", false), false);
});

Deno.test("URL remota é bloqueada sem --allow-remote", () => {
  strictEqual(isLocalUrl("https://abc.supabase.co"), false);
  strictEqual(shouldBlockRemote("https://abc.supabase.co", false), true);
});

Deno.test("URL remota passa só com --allow-remote", () => {
  strictEqual(shouldBlockRemote("https://abc.supabase.co", true), false);
});

Deno.test("URL inválida é tratada como não local", () => {
  strictEqual(isLocalUrl("não é url"), false);
});

Deno.test("marcador de bootstrap e papel têm os valores da ADR", () => {
  strictEqual(BOOTSTRAP_ROLE_KEY, "bootstrap_role");
  strictEqual(BOOTSTRAP_ROLE_VALUE, "super_admin");
});

Deno.test("senha provisória não está vazia", () => {
  notStrictEqual(PROVISIONAL_PASSWORD.length, 0);
});
