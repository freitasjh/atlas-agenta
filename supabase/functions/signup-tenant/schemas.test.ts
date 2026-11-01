// Testes de schema da Edge Function `signup-tenant` (ADR-02). Rodar com:
//   deno test supabase/functions/signup-tenant/schemas.test.ts
import { deepStrictEqual as assertEquals } from "node:assert/strict";
import { parseSignupBody } from "./schemas.ts";

const validBody = {
  email: "dona@salao.com.br",
  password: "Senha@123",
  trade_name: "Salão da Ana",
  full_name: "Ana Souza",
  segment: "salao",
};

Deno.test("aceita corpo válido completo", () => {
  const result = parseSignupBody(validBody);
  assertEquals(result.ok, true);
});

Deno.test("aceita corpo mínimo sem full_name e segment", () => {
  const result = parseSignupBody({
    email: "dona@salao.com.br",
    password: "Senha@123",
    trade_name: "Ana",
  });
  assertEquals(result.ok, true);
});

Deno.test("recusa campo extra com invalid_body", () => {
  assertEquals(parseSignupBody({ ...validBody, role: "super_admin" }), {
    ok: false,
    code: "invalid_body",
  });
  assertEquals(parseSignupBody({ ...validBody, tenant_id: "x" }), {
    ok: false,
    code: "invalid_body",
  });
});

Deno.test("recusa segmento fora do enum com invalid_body", () => {
  assertEquals(parseSignupBody({ ...validBody, segment: "outro" }), {
    ok: false,
    code: "invalid_body",
  });
});

Deno.test("recusa e-mail inválido com invalid_body", () => {
  assertEquals(parseSignupBody({ ...validBody, email: "nao-e-email" }), {
    ok: false,
    code: "invalid_body",
  });
});

Deno.test("recusa nome de empresa de 1 caractere com invalid_body", () => {
  assertEquals(parseSignupBody({ ...validBody, trade_name: "A" }), {
    ok: false,
    code: "invalid_body",
  });
});

Deno.test("recusa senha de 7 caracteres com password_too_short", () => {
  assertEquals(parseSignupBody({ ...validBody, password: "Abc@123" }), {
    ok: false,
    code: "password_too_short",
  });
});

Deno.test("aceita senha de exatamente 8 caracteres", () => {
  assertEquals(parseSignupBody({ ...validBody, password: "Senha@12" }).ok, true);
});

Deno.test("aceita senha de exatamente 72 bytes", () => {
  assertEquals(parseSignupBody({ ...validBody, password: "a".repeat(72) }).ok, true);
});

Deno.test("recusa senha de 73 bytes com password_too_long", () => {
  assertEquals(parseSignupBody({ ...validBody, password: "a".repeat(73) }), {
    ok: false,
    code: "password_too_long",
  });
});

Deno.test("conta bytes UTF-8, não caracteres, no limite de 72", () => {
  // 'é' ocupa 2 bytes: 37 caracteres = 74 bytes, acima do limite.
  assertEquals(parseSignupBody({ ...validBody, password: "é".repeat(37) }), {
    ok: false,
    code: "password_too_long",
  });
});
