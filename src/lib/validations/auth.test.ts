import { describe, expect, it } from "vitest";

import { signupSchema } from "@/lib/validations/auth";
import { BUSINESS_SEGMENTS } from "@/types/domain";

/**
 * Contrato do `signupSchema` quanto ao campo `segment` (ADR-04, AC-04.2/AC-04.3).
 * Peça pura (zod), sem DOM: prova a regra de validação que o `CadastroPage`
 * aplica via `zodResolver` e que decide se `signUp` é chamado. O payload
 * enviado ao `signUp` é derivado deste schema — nunca contém `role`/`tenant_id`.
 */

const baseInput = {
  tradeName: "Studio Lux",
  email: "voce@empresa.com.br",
  password: "senha12345",
  confirmPassword: "senha12345",
};

describe("signupSchema.segment", () => {
  it("AC-04.2: submissão sem ramo falha com a mensagem pt-BR", () => {
    const result = signupSchema.safeParse(baseInput);
    expect(result.success).toBe(false);
    if (result.success) return;
    const issue = result.error.issues.find((i) => i.path[0] === "segment");
    expect(issue?.message).toBe("Escolha o ramo da sua empresa.");
  });

  it("AC-04.2: ramo fora do enum fechado é rejeitado", () => {
    const result = signupSchema.safeParse({ ...baseInput, segment: "outro" });
    expect(result.success).toBe(false);
  });

  it.each([...BUSINESS_SEGMENTS])(
    "AC-04.3: ramo válido '%s' passa e preserva o literal escolhido",
    (segment) => {
      const result = signupSchema.safeParse({ ...baseInput, segment });
      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.data.segment).toBe(segment);
    },
  );

  it("AC-04.3: o shape validado não expõe role nem tenant_id", () => {
    const result = signupSchema.safeParse({
      ...baseInput,
      segment: "barbearia",
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).not.toHaveProperty("role");
    expect(result.data).not.toHaveProperty("tenant_id");
  });
});
