import { describe, expect, it } from "vitest";

import { signupSchema } from "@/lib/validations/auth";
import { BUSINESS_SEGMENTS } from "@/types/domain";
import { cadastroMessages } from "@/auth/cadastro-messages";

/**
 * Contrato do `signupSchema` quanto ao campo `segment` (ADR-002/ADR-003).
 * Peça pura (zod), sem DOM: `segment` é OPCIONAL (o servidor aceita ausente);
 * a sentinela vazia `""` da UI vira ausência; valor fora do enum fechado falha
 * com a mensagem pt-BR do catálogo. O payload enviado ao `signUp` nunca contém
 * `role`/`tenant_id`.
 */

const baseInput = {
  tradeName: "Studio Lux",
  document: "52998224725",
  phoneEmpresa: "11987654321",
  addressCep: "01310100",
  addressStreet: "Avenida Paulista",
  addressNumber: "1000",
  addressCity: "São Paulo",
  addressState: "SP",
  email: "voce@empresa.com.br",
  password: "senha12345",
  confirmPassword: "senha12345",
  fullName: "Ana Souza",
};

describe("signupSchema.segment", () => {
  it("submissão sem ramo passa (opcional, ADR-002)", () => {
    const result = signupSchema.safeParse(baseInput);
    expect(result.success).toBe(true);
  });

  it("a sentinela vazia '' (o que a UI submete) vira ausência e passa", () => {
    const result = signupSchema.safeParse({ ...baseInput, segment: "" });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.segment).toBeUndefined();
  });

  it("ramo fora do enum fechado é rejeitado com a mensagem pt-BR", () => {
    const result = signupSchema.safeParse({ ...baseInput, segment: "outro" });
    expect(result.success).toBe(false);
    if (result.success) return;
    const issue = result.error.issues.find((i) => i.path[0] === "segment");
    expect(issue?.message).toBe(cadastroMessages.errors.segment);
  });

  it.each([...BUSINESS_SEGMENTS])(
    "ramo válido '%s' passa e preserva o literal escolhido",
    (segment) => {
      const result = signupSchema.safeParse({ ...baseInput, segment });
      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.data.segment).toBe(segment);
    },
  );

  it("o shape validado não expõe role nem tenant_id", () => {
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
