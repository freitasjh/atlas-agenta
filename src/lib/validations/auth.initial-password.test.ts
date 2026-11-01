import { describe, expect, it } from "vitest";

import {
  initialPasswordSchema,
  resetPasswordSchema,
} from "@/lib/validations/auth";

/**
 * Contrato do `initialPasswordSchema` (ADR-09/ADR-10).
 *
 * Mínimo 8 caracteres, máximo 72 BYTES UTF-8 (limite do GoTrue — acento conta
 * 2 bytes, emoji 4) e confirmação igual. O `resetPasswordSchema` da recuperação
 * de senha continua com o comportamento anterior.
 */

const MIN_MESSAGE = "A senha deve ter ao menos 8 caracteres.";
const MAX_MESSAGE = "A senha deve ter no máximo 72 bytes.";
const CONFIRM_MESSAGE = "As senhas não coincidem.";

function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).length;
}

function issuesOf(password: string, confirmPassword = password) {
  const result = initialPasswordSchema.safeParse({ password, confirmPassword });
  return result.success ? [] : result.error.issues;
}

describe("initialPasswordSchema", () => {
  it("aceita senha de exatamente 72 bytes com acento (36 'á')", () => {
    const password = "á".repeat(36);
    expect(utf8Bytes(password)).toBe(72);

    const result = initialPasswordSchema.safeParse({
      password,
      confirmPassword: password,
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.password).toBe(password);
  });

  it("recusa 73 bytes com acento com a mensagem de máximo", () => {
    const password = `${"á".repeat(35)}abc`;
    expect(utf8Bytes(password)).toBe(73);

    const issues = issuesOf(password);
    const issue = issues.find((item) => item.path[0] === "password");

    expect(issue?.message).toBe(MAX_MESSAGE);
  });

  it("recusa senha de 7 caracteres com a mensagem de mínimo", () => {
    const issues = issuesOf("1234567");
    const issue = issues.find((item) => item.path[0] === "password");

    expect(issue?.message).toBe(MIN_MESSAGE);
  });

  it("aceita 8 caracteres", () => {
    const result = initialPasswordSchema.safeParse({
      password: "12345678",
      confirmPassword: "12345678",
    });

    expect(result.success).toBe(true);
  });

  it("conta code points: 7 emojis (14 unidades UTF-16) são recusados", () => {
    const password = "😀".repeat(7);
    expect(password.length).toBe(14);
    expect(Array.from(password).length).toBe(7);

    const issues = issuesOf(password);
    const issue = issues.find((item) => item.path[0] === "password");

    expect(issue?.code).toBe("too_small");
    expect(issue?.message).toBe(MIN_MESSAGE);
  });

  it("conta code points: 8 emojis (32 bytes) são aceitos", () => {
    const password = "😀".repeat(8);
    expect(Array.from(password).length).toBe(8);
    expect(utf8Bytes(password)).toBe(32);

    const result = initialPasswordSchema.safeParse({
      password,
      confirmPassword: password,
    });

    expect(result.success).toBe(true);
  });

  it("aceita 72 caracteres ASCII (72 bytes)", () => {
    const password = "a".repeat(72);
    expect(utf8Bytes(password)).toBe(72);

    const result = initialPasswordSchema.safeParse({
      password,
      confirmPassword: password,
    });

    expect(result.success).toBe(true);
  });

  it("recusa confirmação diferente com a mensagem pt-BR no campo", () => {
    const issues = issuesOf("senha-segura-1", "senha-segura-2");
    const issue = issues.find((item) => item.path[0] === "confirmPassword");

    expect(issue?.message).toBe(CONFIRM_MESSAGE);
  });
});

describe("resetPasswordSchema (recuperação de senha)", () => {
  it("continua exigindo 8 caracteres", () => {
    const result = resetPasswordSchema.safeParse({
      password: "1234567",
      confirmPassword: "1234567",
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    const issue = result.error.issues.find(
      (item) => item.path[0] === "password",
    );
    expect(issue?.message).toBe(MIN_MESSAGE);
  });

  it("continua aceitando senha válida com confirmação igual", () => {
    const result = resetPasswordSchema.safeParse({
      password: "senha-segura-1",
      confirmPassword: "senha-segura-1",
    });

    expect(result.success).toBe(true);
  });
});
