// Testes de schema da Edge Function `signup-tenant` (ADR-002 cadastro rico). Rodar com:
//   deno test supabase/functions/signup-tenant/schemas.test.ts
//
// Os vetores de DV abaixo são os MESMOS da migration (BE-01) e do teste de integração (IT-02):
// DV idêntico nos dois lados. Nenhum valor real de PII aqui — só documentos fictícios de teste.
import { deepStrictEqual as assertEquals, ok as assertOk } from "node:assert/strict";
import {
  isValidCnpj,
  isValidCpf,
  isValidDocument,
  parseSignupBody,
  stripDigits,
} from "./schemas.ts";

/** CPF válido clássico (dígitos verificadores 2 e 5). */
const VALID_CPF = "52998224725";
/** CNPJ válido clássico (dígitos verificadores 8 e 1). */
const VALID_CNPJ = "11222333000181";

const validBody = {
  email: "dona@salao.com.br",
  password: "Senha@123",
  trade_name: "Salão da Ana",
  legal_name: "Ana Souza LTDA",
  document: VALID_CPF,
  phone_empresa: "11987654321",
  address_cep: "01310100",
  address_street: "Avenida Paulista",
  address_number: "1000",
  address_city: "São Paulo",
  address_state: "SP",
  full_name: "Ana Souza",
  segment: "salao",
};

Deno.test("aceita corpo válido completo", () => {
  const result = parseSignupBody(validBody);
  assertEquals(result.ok, true);
});

Deno.test("aceita CNPJ válido", () => {
  const result = parseSignupBody({ ...validBody, document: VALID_CNPJ });
  assertEquals(result.ok, true);
});

Deno.test("aceita corpo mínimo sem opcionais (legal_name, complement, segment)", () => {
  const { legal_name: _ln, address_complement: _ac, segment: _sg, ...rest } = {
    ...validBody,
    address_complement: "Sala 1",
  };
  const result = parseSignupBody(rest);
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
  assertEquals(parseSignupBody({ ...validBody, whatsapp: "11999999999" }), {
    ok: false,
    code: "invalid_body",
  });
  assertEquals(parseSignupBody({ ...validBody, app_metadata: { role: "admin" } }), {
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

// --- DV CPF/CNPJ (mesmos vetores da RPC) ---

Deno.test("isValidCpf aceita CPF válido e rejeita DV errado", () => {
  assertEquals(isValidCpf(VALID_CPF), true);
  assertEquals(isValidCpf("52998224726"), false);
});

Deno.test("isValidCnpj aceita CNPJ válido e rejeita DV errado", () => {
  assertEquals(isValidCnpj(VALID_CNPJ), true);
  assertEquals(isValidCnpj("11222333000182"), false);
});

Deno.test("sequências de dígito repetido são inválidas (CPF e CNPJ)", () => {
  for (const doc of ["00000000000", "11111111111", "99999999999"]) {
    assertEquals(isValidCpf(doc), false);
  }
  for (const doc of ["00000000000000", "11111111111111", "22222222222222"]) {
    assertEquals(isValidCnpj(doc), false);
  }
  assertEquals(isValidDocument("00000000000"), false);
  assertEquals(isValidDocument("11111111111111"), false);
});

Deno.test("isValidDocument exige 11 ou 14 dígitos", () => {
  assertEquals(isValidDocument("1234567890"), false);
  assertEquals(isValidDocument("123456789012"), false);
  assertEquals(isValidDocument("123456789012345"), false);
});

Deno.test("documento com DV errado responde document_invalido", () => {
  assertEquals(parseSignupBody({ ...validBody, document: "52998224726" }), {
    ok: false,
    code: "document_invalido",
  });
  assertEquals(parseSignupBody({ ...validBody, document: "11222333000182" }), {
    ok: false,
    code: "document_invalido",
  });
});

Deno.test("sequência repetida no corpo responde document_invalido", () => {
  assertEquals(parseSignupBody({ ...validBody, document: "11111111111" }), {
    ok: false,
    code: "document_invalido",
  });
});

Deno.test("documento ausente responde document_invalido", () => {
  const { document: _doc, ...rest } = validBody;
  assertEquals(parseSignupBody(rest), { ok: false, code: "document_invalido" });
});

// --- Strip de máscara e normalização ---

Deno.test("stripDigits remove máscara e ignora não-string", () => {
  assertEquals(stripDigits("12.345.678/0001-81"), "12345678000181");
  assertEquals(stripDigits("(11) 98765-4321"), "11987654321");
  assertEquals(stripDigits(123), "");
});

Deno.test("aceita documento/telefone/CEP mascarados e normaliza o corpo", () => {
  const result = parseSignupBody({
    ...validBody,
    document: "529.982.247-25",
    phone_empresa: "(11) 98765-4321",
    address_cep: "01310-100",
    address_state: "sp",
  });
  assertEquals(result.ok, true);
  if (result.ok) {
    assertEquals(result.body.document, VALID_CPF);
    assertEquals(result.body.phone_empresa, "11987654321");
    assertEquals(result.body.address_cep, "01310100");
    assertEquals(result.body.address_state, "SP");
  }
});

// --- Códigos por campo (ADR-002) ---

Deno.test("telefone fora do formato responde telefone_invalido", () => {
  assertEquals(parseSignupBody({ ...validBody, phone_empresa: "11-9999" }), {
    ok: false,
    code: "telefone_invalido",
  });
  const { phone_empresa: _ph, ...rest } = validBody;
  assertEquals(parseSignupBody(rest), { ok: false, code: "telefone_invalido" });
});

Deno.test("endereço incompleto responde endereco_incompleto", () => {
  assertEquals(parseSignupBody({ ...validBody, address_cep: "0131010" }), {
    ok: false,
    code: "endereco_incompleto",
  });
  const { address_city: _ct, ...noCity } = validBody;
  assertEquals(parseSignupBody(noCity), { ok: false, code: "endereco_incompleto" });
  const { address_state: _st, ...noState } = validBody;
  assertEquals(parseSignupBody(noState), { ok: false, code: "endereco_incompleto" });
});

Deno.test("nome do admin vazio responde nome_admin_obrigatorio", () => {
  assertEquals(parseSignupBody({ ...validBody, full_name: "   " }), {
    ok: false,
    code: "nome_admin_obrigatorio",
  });
  const { full_name: _fn, ...rest } = validBody;
  assertEquals(parseSignupBody(rest), { ok: false, code: "nome_admin_obrigatorio" });
});

// --- Sem PII em logs ---

Deno.test("parseSignupBody nunca loga (nenhum valor chega a console)", () => {
  const calls: unknown[][] = [];
  const origError = console.error;
  const origLog = console.log;
  const origWarn = console.warn;
  console.error = (...args: unknown[]) => void calls.push(args);
  console.log = (...args: unknown[]) => void calls.push(args);
  console.warn = (...args: unknown[]) => void calls.push(args);
  try {
    parseSignupBody(validBody);
    parseSignupBody({ ...validBody, document: "11111111111" });
    parseSignupBody({ ...validBody, role: "x" });
  } finally {
    console.error = origError;
    console.log = origLog;
    console.warn = origWarn;
  }
  assertOk(calls.length === 0, "parseSignupBody não deve logar nada");
});
