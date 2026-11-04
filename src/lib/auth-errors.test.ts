import { describe, expect, it } from "vitest";

import { mapSignUpError } from "@/lib/auth-errors";

/**
 * Tabela de erros do cadastro da empresa (ADR-03).
 *
 * A entrada é o erro do `functions.invoke("signup-tenant")` (dado NÃO
 * confiável): o mapeamento só classifica por `status`/`code` estáveis e nunca
 * devolve à tela a mensagem do servidor.
 *
 * - 409 + `email_ja_cadastrado` → "Este e-mail já tem cadastro."
 * - 409 + `document_ja_cadastrado` → "Este CNPJ/CPF já tem cadastro." (ADR-002)
 * - todo o resto (400, 409 sem código, 500, rede, formato estranho) → genérica.
 */

const EMAIL_TAKEN = "Este e-mail já tem cadastro.";
const DOCUMENT_TAKEN = "Este CNPJ/CPF já tem cadastro.";
const GENERIC = "Não foi possível criar sua conta. Tente novamente.";

/** Erro no shape que o hook entrega: `{ status, code }`, sem o corpo do servidor. */
function normalizedError(status: number, code?: string) {
  return code === undefined
    ? Object.assign(new Error("signup_failed"), { status })
    : Object.assign(new Error("signup_failed"), { status, code });
}

describe("mapSignUpError", () => {
  it("409 com código email_ja_cadastrado ⇒ e-mail já cadastrado", () => {
    expect(
      mapSignUpError(normalizedError(409, "email_ja_cadastrado")),
    ).toBe(EMAIL_TAKEN);
  });

  it("409 com o código no campo error ⇒ e-mail já cadastrado", () => {
    expect(
      mapSignUpError({ status: 409, error: "email_ja_cadastrado" }),
    ).toBe(EMAIL_TAKEN);
  });

  it("409 com o código no corpo ⇒ e-mail já cadastrado", () => {
    expect(
      mapSignUpError({ status: 409, body: { code: "email_ja_cadastrado" } }),
    ).toBe(EMAIL_TAKEN);
  });

  it("409 com código document_ja_cadastrado ⇒ mensagem exata do catálogo", () => {
    expect(
      mapSignUpError(normalizedError(409, "document_ja_cadastrado")),
    ).toBe(DOCUMENT_TAKEN);
  });

  it("409 sem código legível (gateway/proxy) ⇒ genérica, nunca vira e-mail repetido", () => {
    expect(mapSignUpError(normalizedError(409))).toBe(GENERIC);
    expect(mapSignUpError({ context: { status: 409 } })).toBe(GENERIC);
    expect(mapSignUpError({ context: new Response(null, { status: 409 }) })).toBe(
      GENERIC,
    );
  });

  it("409 com código desconhecido ⇒ genérica", () => {
    expect(mapSignUpError(normalizedError(409, "conflict"))).toBe(GENERIC);
  });

  it("400 invalid_body ⇒ genérica", () => {
    expect(mapSignUpError(normalizedError(400, "invalid_body"))).toBe(GENERIC);
  });

  it("400 password_too_short / password_too_long ⇒ genérica", () => {
    expect(
      mapSignUpError(normalizedError(400, "password_too_short")),
    ).toBe(GENERIC);
    expect(
      mapSignUpError(normalizedError(400, "password_too_long")),
    ).toBe(GENERIC);
  });

  it("500 cadastro_falhou / internal_error ⇒ genérica", () => {
    expect(mapSignUpError(normalizedError(500, "cadastro_falhou"))).toBe(GENERIC);
    expect(mapSignUpError(normalizedError(500, "internal_error"))).toBe(GENERIC);
  });

  it("401 e 403 (gateway) ⇒ genérica", () => {
    expect(mapSignUpError(normalizedError(401))).toBe(GENERIC);
    expect(mapSignUpError(normalizedError(403))).toBe(GENERIC);
  });

  it("falha de rede ⇒ genérica", () => {
    expect(mapSignUpError(new TypeError("Failed to fetch"))).toBe(GENERIC);
  });

  it("entrada sem forma conhecida (nulo, primitivo) ⇒ genérica e nunca lança", () => {
    for (const value of [null, undefined, 42, "erro", [], {}]) {
      expect(mapSignUpError(value)).toBe(GENERIC);
    }
  });

  it("nunca devolve a mensagem do servidor", () => {
    const serverText = "duplicate key value violates unique constraint auth_users";
    const error = Object.assign(new Error(serverText), {
      status: 400,
      message: serverText,
      code: "internal_error",
    });

    const message = mapSignUpError(error);

    expect(message).toBe(GENERIC);
    expect(message).not.toContain("duplicate key");
  });
});
