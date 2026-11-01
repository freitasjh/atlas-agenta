import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  isInitialSessionExpiredError,
  mapInitialPasswordError,
} from "@/lib/auth-errors";
import { initialPasswordSchema } from "@/lib/validations/auth";

/**
 * Tabela de erros da troca de senha obrigatória (ADR-09).
 *
 * A entrada é o erro do `functions.invoke("change-password")` (dado NÃO
 * confiável): o mapeamento só classifica por `status`/`code` e nunca devolve à
 * tela a mensagem do servidor. Os casos abaixo seguem a tabela linha a linha.
 */

const SESSION_EXPIRED = "Sua sessão expirou. Entre novamente.";
const PASSWORD_IS_INITIAL = "Escolha uma senha diferente da atual.";
const PASSWORD_TOO_SHORT = "A senha deve ter ao menos 8 caracteres.";
const PASSWORD_TOO_LONG = "A senha deve ter no máximo 72 bytes.";
const CHANGE_IN_PROGRESS = "Aguarde e tente novamente.";
const GENERIC = "Não foi possível salvar a nova senha. Tente novamente.";

function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).length;
}

describe("mapInitialPasswordError", () => {
  it("401 com status direto (gateway ou própria função) → sessão expirada", () => {
    expect(mapInitialPasswordError({ status: 401 })).toBe(SESSION_EXPIRED);
  });

  it("401 lido do context (Response do FunctionsHttpError) → sessão expirada", () => {
    expect(
      mapInitialPasswordError({ context: { status: 401 } }),
    ).toBe(SESSION_EXPIRED);
  });

  it("401 por código unauthenticated, mesmo sem status → sessão expirada", () => {
    expect(mapInitialPasswordError({ code: "unauthenticated" })).toBe(
      SESSION_EXPIRED,
    );
  });

  it("409 password_change_superseded → sessão expirada (token defasado)", () => {
    expect(
      mapInitialPasswordError({
        status: 409,
        code: "password_change_superseded",
        message:
          "Sua troca de senha não foi concluída, porque outra tentativa a substituiu.",
      }),
    ).toBe(SESSION_EXPIRED);
  });

  it("409 password_change_superseded sem status → sessão expirada (só o código basta)", () => {
    expect(
      mapInitialPasswordError({ code: "password_change_superseded" }),
    ).toBe(SESSION_EXPIRED);
  });

  it("409 password_change_in_progress → pede para aguardar", () => {
    expect(
      mapInitialPasswordError({
        status: 409,
        code: "password_change_in_progress",
        message: "Já existe uma troca de senha em andamento.",
      }),
    ).toBe(CHANGE_IN_PROGRESS);
  });

  it("409 sem código (gateway/proxy) → genérica, nunca sessão expirada", () => {
    const message = mapInitialPasswordError({ status: 409 });

    expect(message).toBe(GENERIC);
    expect(message).not.toBe(SESSION_EXPIRED);
  });

  it("400 password_is_initial → pede senha diferente da atual", () => {
    expect(
      mapInitialPasswordError({ status: 400, code: "password_is_initial" }),
    ).toBe(PASSWORD_IS_INITIAL);
  });

  it("400 password_too_short → mínimo de 8 caracteres", () => {
    expect(
      mapInitialPasswordError({ status: 400, code: "password_too_short" }),
    ).toBe(PASSWORD_TOO_SHORT);
  });

  it("400 password_too_long (73 bytes com acento) → máximo de 72 bytes", () => {
    const password = `${"á".repeat(35)}abc`;
    expect(utf8Bytes(password)).toBe(73);

    expect(
      mapInitialPasswordError({
        status: 400,
        code: "password_too_long",
        message: "A senha deve ter no máximo 72 bytes.",
      }),
    ).toBe(PASSWORD_TOO_LONG);
  });

  it("400 invalid_body → genérica (sem vazar o schema do servidor)", () => {
    expect(
      mapInitialPasswordError({ status: 400, code: "invalid_body" }),
    ).toBe(GENERIC);
  });

  it("500 → genérica", () => {
    expect(mapInitialPasswordError({ status: 500 })).toBe(GENERIC);
  });

  it("503 auth_indisponivel → genérica", () => {
    expect(
      mapInitialPasswordError({ status: 503, code: "auth_indisponivel" }),
    ).toBe(GENERIC);
  });

  it("falha de rede (TypeError) → genérica", () => {
    expect(
      mapInitialPasswordError(new TypeError("Failed to fetch")),
    ).toBe(GENERIC);
  });

  it("validação local (ZodError de mínimo) → mínimo de 8 caracteres", () => {
    const result = z
      .object({ password: z.string().min(8, PASSWORD_TOO_SHORT) })
      .safeParse({ password: "1234567" });

    expect(result.success).toBe(false);
    if (result.success) return;

    expect(mapInitialPasswordError(result.error)).toBe(PASSWORD_TOO_SHORT);
  });

  it("validação local (ZodError de máximo) → máximo de 72 bytes", () => {
    const result = z
      .object({ password: z.string().max(72, PASSWORD_TOO_LONG) })
      .safeParse({ password: "a".repeat(73) });

    expect(result.success).toBe(false);
    if (result.success) return;

    expect(mapInitialPasswordError(result.error)).toBe(PASSWORD_TOO_LONG);
  });

  it("confirmação diferente (issue custom) → genérica, não 'ao menos 8 caracteres'", () => {
    const result = initialPasswordSchema.safeParse({
      password: "senha-segura-1",
      confirmPassword: "senha-segura-2",
    });

    expect(result.success).toBe(false);
    if (result.success) return;

    expect(mapInitialPasswordError(result.error)).toBe(GENERIC);
  });

  it("classifica o ZodError real do schema por issue.code (sem regex de mensagem)", () => {
    const short = initialPasswordSchema.safeParse({
      password: "1234567",
      confirmPassword: "1234567",
    });
    expect(short.success).toBe(false);
    if (!short.success) {
      expect(short.error.issues[0]?.code).toBe("too_small");
      expect(mapInitialPasswordError(short.error)).toBe(PASSWORD_TOO_SHORT);
    }

    const long = initialPasswordSchema.safeParse({
      password: `${"á".repeat(35)}abc`,
      confirmPassword: `${"á".repeat(35)}abc`,
    });
    expect(long.success).toBe(false);
    if (!long.success) {
      expect(long.error.issues[0]?.code).toBe("too_big");
      expect(mapInitialPasswordError(long.error)).toBe(PASSWORD_TOO_LONG);
    }
  });

  it("mensagem do servidor nunca aparece na tela", () => {
    const message = mapInitialPasswordError({
      status: 500,
      message: "internal_error: bcrypt hash mismatch at auth.users row 42",
    });

    expect(message).toBe(GENERIC);
    expect(message).not.toMatch(/bcrypt|auth\.users|42/);
  });

  it.each([null, undefined, "falhou", 42, []])(
    "entrada sem shape (%s) não lança e cai na genérica",
    (input) => {
      expect(() => mapInitialPasswordError(input)).not.toThrow();
      expect(mapInitialPasswordError(input)).toBe(GENERIC);
    },
  );
});

/**
 * A tela de troca usa o predicado para decidir se oferece o link de login
 * (ADR-10, achado 3 da revisão). Ele precisa concordar EXATAMENTE com a linha
 * "sessão expirada" do mapeador — mensagem e link nunca divergem.
 */
describe("isInitialSessionExpiredError", () => {
  it.each([
    ["401 direto", { status: 401 }],
    ["401 do context", { context: { status: 401 } }],
    ["401 por statusCode", { statusCode: 401 }],
    ["unauthenticated sem status", { code: "unauthenticated" }],
    ["unauthenticated no body", { body: { code: "unauthenticated" } }],
    [
      "superseded com status",
      { status: 409, code: "password_change_superseded" },
    ],
    ["superseded sem status", { code: "password_change_superseded" }],
  ])("reconhece sessão expirada: %s", (_case, input) => {
    expect(isInitialSessionExpiredError(input)).toBe(true);
    expect(mapInitialPasswordError(input)).toBe(SESSION_EXPIRED);
  });

  it.each([
    ["409 in_progress", { status: 409, code: "password_change_in_progress" }],
    ["409 sem código", { status: 409 }],
    ["400 password_is_initial", { status: 400, code: "password_is_initial" }],
    ["400 password_too_short", { status: 400, code: "password_too_short" }],
    ["500", { status: 500 }],
    ["403", { status: 403 }],
    ["rede", new TypeError("Failed to fetch")],
    ["null", null],
    ["string", "falhou"],
    ["array", []],
  ])("NÃO trata como sessão expirada: %s", (_case, input) => {
    expect(isInitialSessionExpiredError(input)).toBe(false);
    expect(mapInitialPasswordError(input)).not.toBe(SESSION_EXPIRED);
  });

  it("nunca lança", () => {
    for (const input of [undefined, null, 0, "", {}, Symbol("x")]) {
      expect(() => isInitialSessionExpiredError(input)).not.toThrow();
    }
  });
});
