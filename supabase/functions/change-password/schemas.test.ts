// Testes de schema da Edge Function `change-password` (ADR-08). Rodar com:
//   deno test supabase/functions/change-password/schemas.test.ts
import { deepStrictEqual as assertEquals } from "node:assert/strict";
import {
  buildPasswordUpdate,
  isDefinitiveAuthRejection,
  parseChangePasswordBody,
} from "./schemas.ts";
import { PROVISIONAL_PASSWORD } from "../_shared/super-admin-bootstrap.ts";

Deno.test("update do Auth zera must_change_password preservando o restante", () => {
  const current = {
    provider: "email",
    providers: ["email"],
    must_change_password: true,
  };
  assertEquals(buildPasswordUpdate(current, "Senha@123"), {
    password: "Senha@123",
    app_metadata: {
      provider: "email",
      providers: ["email"],
      must_change_password: false,
    },
  });
  // O objeto lido de getUser não é mutado: o update usa uma cópia.
  assertEquals(current.must_change_password, true);
});

Deno.test("update do Auth sem app_metadata só define a flag false", () => {
  assertEquals(buildPasswordUpdate(undefined, "Senha@123"), {
    password: "Senha@123",
    app_metadata: { must_change_password: false },
  });
  assertEquals(buildPasswordUpdate(null, "Senha@123"), {
    password: "Senha@123",
    app_metadata: { must_change_password: false },
  });
});

Deno.test("update do Auth ignora app_metadata que não é objeto", () => {
  assertEquals(buildPasswordUpdate("nao-e-objeto", "Senha@123"), {
    password: "Senha@123",
    app_metadata: { must_change_password: false },
  });
  assertEquals(buildPasswordUpdate(["provider"], "Senha@123"), {
    password: "Senha@123",
    app_metadata: { must_change_password: false },
  });
});

Deno.test("libera reserva só para resposta 4xx do Auth", () => {
  assertEquals(isDefinitiveAuthRejection(422), true);
  assertEquals(isDefinitiveAuthRejection(401), true);
  assertEquals(isDefinitiveAuthRejection(500), false);
  assertEquals(isDefinitiveAuthRejection(503), false);
  assertEquals(isDefinitiveAuthRejection(0), false);
  assertEquals(isDefinitiveAuthRejection(undefined), false);
});

Deno.test("aceita senha válida com 8 caracteres", () => {
  assertEquals(parseChangePasswordBody({ password: "Senha@123" }), {
    ok: true,
    password: "Senha@123",
  });
});

Deno.test("recusa senha de 7 caracteres com password_too_short", () => {
  assertEquals(parseChangePasswordBody({ password: "Abc@123" }), {
    ok: false,
    code: "password_too_short",
  });
});

Deno.test("recusa senha vazia com password_too_short", () => {
  assertEquals(parseChangePasswordBody({ password: "" }), {
    ok: false,
    code: "password_too_short",
  });
});

Deno.test("aceita senha de exatamente 72 bytes", () => {
  const password = "a".repeat(72);
  assertEquals(parseChangePasswordBody({ password }), { ok: true, password });
});

Deno.test("recusa senha de 73 bytes com password_too_long", () => {
  assertEquals(parseChangePasswordBody({ password: "a".repeat(73) }), {
    ok: false,
    code: "password_too_long",
  });
});

Deno.test("conta bytes UTF-8, não caracteres, no limite de 72", () => {
  // 'é' ocupa 2 bytes: 37 caracteres = 74 bytes, acima do limite.
  assertEquals(parseChangePasswordBody({ password: "é".repeat(37) }), {
    ok: false,
    code: "password_too_long",
  });
});

Deno.test("recusa a senha provisória com password_is_initial", () => {
  assertEquals(parseChangePasswordBody({ password: PROVISIONAL_PASSWORD }), {
    ok: false,
    code: "password_is_initial",
  });
});

Deno.test("recusa campo extra no corpo com invalid_body", () => {
  assertEquals(
    parseChangePasswordBody({ password: "Senha@123", user_id: "x" }),
    { ok: false, code: "invalid_body" },
  );
});

Deno.test("recusa password com tipo errado com invalid_body", () => {
  assertEquals(parseChangePasswordBody({ password: 12345678 }), {
    ok: false,
    code: "invalid_body",
  });
});

Deno.test("recusa corpo sem password com invalid_body", () => {
  assertEquals(parseChangePasswordBody({}), { ok: false, code: "invalid_body" });
  assertEquals(parseChangePasswordBody(null), {
    ok: false,
    code: "invalid_body",
  });
});
