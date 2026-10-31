// Testes unitários do bootstrap do super admin (ADR-07). Rodar com: deno test scripts/bootstrap-super-admin.test.ts
import { deepStrictEqual, strictEqual } from "node:assert/strict";
import { decideBootstrapAction } from "../supabase/functions/_shared/super-admin-bootstrap.ts";
import {
  isAuthUsersUniqueViolation,
  isLocalUrl,
  isParsableUrl,
  shouldBlockRemote,
  sslOptionsFor,
} from "./bootstrap-super-admin.ts";

Deno.test("usuário inexistente resulta em criado", () => {
  strictEqual(decideBootstrapAction({ exists: false }), "criado");
});

Deno.test("super admin sem tenant resulta em ja_existe", () => {
  strictEqual(
    decideBootstrapAction({
      exists: true,
      profileRole: "super_admin",
      tenantId: null,
    }),
    "ja_existe",
  );
});

Deno.test("admin de tenant resulta em recusa_papel", () => {
  strictEqual(
    decideBootstrapAction({
      exists: true,
      profileRole: "admin",
      tenantId: "t-1",
    }),
    "recusa_papel",
  );
});

Deno.test("super admin com tenant preenchido resulta em recusa_papel", () => {
  strictEqual(
    decideBootstrapAction({
      exists: true,
      profileRole: "super_admin",
      tenantId: "t-1",
    }),
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

Deno.test("localhost usa conexão sem TLS", () => {
  strictEqual(
    sslOptionsFor("postgres://u:p@127.0.0.1:54322/postgres", undefined),
    false,
  );
});

Deno.test("host remoto exige verify-full sem CA customizada", () => {
  strictEqual(
    sslOptionsFor("postgres://u:p@db.abc.supabase.co:5432/postgres", undefined),
    "verify-full",
  );
});

Deno.test("host remoto com CA informada valida certificado com essa CA", () => {
  deepStrictEqual(
    sslOptionsFor("postgres://u:p@db.abc.supabase.co:5432/postgres", "PEM"),
    { ca: "PEM", rejectUnauthorized: true },
  );
});

Deno.test("violação de unicidade em auth.users conta como corrida", () => {
  strictEqual(
    isAuthUsersUniqueViolation({
      code: "23505",
      schema_name: "auth",
      table_name: "users",
    }),
    true,
  );
});

Deno.test("violação em auth.identities ou profiles não conta como corrida", () => {
  strictEqual(
    isAuthUsersUniqueViolation({
      code: "23505",
      schema_name: "auth",
      table_name: "identities",
    }),
    false,
  );
  strictEqual(
    isAuthUsersUniqueViolation({
      code: "23505",
      schema_name: "public",
      table_name: "profiles",
    }),
    false,
  );
  strictEqual(isAuthUsersUniqueViolation(new Error("outro erro")), false);
});

Deno.test("URL inválida não é parseável", () => {
  strictEqual(isParsableUrl("postgres://user:senha@host:porta_ruim/db"), false);
  strictEqual(isParsableUrl("postgres://user:senha@host:5432/db"), true);
});

Deno.test("URL de banco malformada não vaza a senha na saída do script", async () => {
  const secret = "SEGREDO-TESTE-ADR07";
  const script =
    new URL("./bootstrap-super-admin.ts", import.meta.url).pathname;
  const output = await new Deno.Command(Deno.execPath(), {
    args: [
      "run",
      "--allow-env",
      "--allow-net",
      "--allow-read",
      script,
      "--allow-remote",
    ],
    env: {
      SUPABASE_DB_URL:
        `postgres://user:${secret}@db.example.com:porta_ruim/postgres`,
    },
    stdout: "piped",
    stderr: "piped",
  }).output();
  const text = new TextDecoder().decode(output.stdout) +
    new TextDecoder().decode(output.stderr);
  strictEqual(output.code, 1);
  strictEqual(text.includes(secret), false);
  strictEqual(text.includes("postgres://"), false);
});
