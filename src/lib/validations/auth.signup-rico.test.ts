import { describe, expect, it } from "vitest";

import { signupSchema } from "@/lib/validations/auth";
import { cadastroMessages } from "@/auth/cadastro-messages";

/**
 * FE-02 — `signupSchema` estendido (ADR-003, contrato ADR-002).
 *
 * Cliente == servidor: os vetores de DV abaixo são os MESMOS da Edge
 * `signup-tenant/schemas.test.ts` e da RPC (BE-01/IT-02). Só documentos
 * fictícios de teste, nenhuma PII real.
 */

const VALID_CPF = "52998224725";
const VALID_CNPJ = "11222333000181";

const baseInput = {
  tradeName: "Salão da Ana",
  legalName: "Ana Souza LTDA",
  document: VALID_CPF,
  phoneEmpresa: "11987654321",
  addressCep: "01310100",
  addressStreet: "Avenida Paulista",
  addressNumber: "1000",
  addressCity: "São Paulo",
  addressState: "SP",
  email: "dona@salao.com.br",
  password: "Senha@123",
  confirmPassword: "Senha@123",
  fullName: "Ana Souza",
  segment: "salao",
};

describe("signupSchema — corpo completo válido", () => {
  it("aceita corpo válido com CPF", () => {
    expect(signupSchema.safeParse(baseInput).success).toBe(true);
  });

  it("aceita corpo válido com CNPJ", () => {
    const result = signupSchema.safeParse({
      ...baseInput,
      document: VALID_CNPJ,
    });
    expect(result.success).toBe(true);
  });

  it("aceita mínimo sem opcionais (legal_name, complement, segment)", () => {
    const { legalName: _ln, addressComplement: _ac, segment: _sg, ...rest } = {
      ...baseInput,
      addressComplement: "Sala 1",
    };
    expect(signupSchema.safeParse(rest).success).toBe(true);
  });

  it("aceita máscaras e normaliza (só dígitos + UF maiúscula)", () => {
    const result = signupSchema.safeParse({
      ...baseInput,
      document: "529.982.247-25",
      phoneEmpresa: "(11) 98765-4321",
      addressCep: "01310-100",
      addressState: "sp",
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.document).toBe(VALID_CPF);
    expect(result.data.phoneEmpresa).toBe("11987654321");
    expect(result.data.addressCep).toBe("01310100");
    expect(result.data.addressState).toBe("SP");
  });

  it("não expõe role nem tenant_id", () => {
    const result = signupSchema.safeParse(baseInput);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).not.toHaveProperty("role");
    expect(result.data).not.toHaveProperty("tenant_id");
  });
});

describe("signupSchema — documento (vetores espelhados do servidor)", () => {
  it("DV errado de CPF falha com mensagem do catálogo", () => {
    const result = signupSchema.safeParse({
      ...baseInput,
      document: "52998224726",
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    const issue = result.error.issues.find((i) => i.path[0] === "document");
    expect(issue?.message).toBe(cadastroMessages.errors.documentInvalid);
  });

  it("DV errado de CNPJ falha com mensagem do catálogo", () => {
    const result = signupSchema.safeParse({
      ...baseInput,
      document: "11222333000182",
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    const issue = result.error.issues.find((i) => i.path[0] === "document");
    expect(issue?.message).toBe(cadastroMessages.errors.documentInvalid);
  });

  it("sequência repetida é inválida", () => {
    for (const document of ["11111111111", "11111111111111"]) {
      const result = signupSchema.safeParse({ ...baseInput, document });
      expect(result.success).toBe(false);
    }
  });

  it("ausente pede o documento", () => {
    const result = signupSchema.safeParse({ ...baseInput, document: "" });
    expect(result.success).toBe(false);
    if (result.success) return;
    const issue = result.error.issues.find((i) => i.path[0] === "document");
    expect(issue?.message).toBe(cadastroMessages.errors.documentRequired);
  });

  it("comprimento fora de 11/14 é inválido", () => {
    for (const document of ["1234567890", "123456789012"]) {
      const result = signupSchema.safeParse({ ...baseInput, document });
      expect(result.success).toBe(false);
    }
  });
});

describe("signupSchema — telefone e endereço", () => {
  it("telefone fora de 10/11 dígitos falha", () => {
    const result = signupSchema.safeParse({
      ...baseInput,
      phoneEmpresa: "11-9999",
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    const issue = result.error.issues.find((i) => i.path[0] === "phoneEmpresa");
    expect(issue?.message).toBe(cadastroMessages.errors.phoneEmpresa);
  });

  it("aceita fixo de 10 dígitos", () => {
    expect(
      signupSchema.safeParse({ ...baseInput, phoneEmpresa: "1133334444" })
        .success,
    ).toBe(true);
  });

  it("CEP com 7 dígitos falha", () => {
    const result = signupSchema.safeParse({
      ...baseInput,
      addressCep: "0131010",
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    const issue = result.error.issues.find((i) => i.path[0] === "addressCep");
    expect(issue?.message).toBe(cadastroMessages.errors.addressCepInvalid);
  });

  it("UF fora das 27 siglas falha", () => {
    const result = signupSchema.safeParse({
      ...baseInput,
      addressState: "XX",
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    const issue = result.error.issues.find((i) => i.path[0] === "addressState");
    expect(issue?.message).toBe(cadastroMessages.errors.addressState);
  });

  it("endereço incompleto por campo tem mensagem do catálogo", () => {
    const cases = [
      ["addressStreet", cadastroMessages.errors.addressStreet],
      ["addressNumber", cadastroMessages.errors.addressNumber],
      ["addressCity", cadastroMessages.errors.addressCity],
    ] as const;
    for (const [field, message] of cases) {
      const result = signupSchema.safeParse({ ...baseInput, [field]: "  " });
      expect(result.success).toBe(false);
      if (result.success) continue;
      expect(
        result.error.issues.find((i) => i.path[0] === field)?.message,
      ).toBe(message);
    }
  });
});

describe("signupSchema — responsável e acesso", () => {
  it("nome vazio falha", () => {
    const result = signupSchema.safeParse({ ...baseInput, fullName: "   " });
    expect(result.success).toBe(false);
    if (result.success) return;
    const issue = result.error.issues.find((i) => i.path[0] === "fullName");
    expect(issue?.message).toBe(cadastroMessages.errors.fullName);
  });

  it("segmento fora do enum falha com mensagem do catálogo", () => {
    const result = signupSchema.safeParse({ ...baseInput, segment: "outro" });
    expect(result.success).toBe(false);
    if (result.success) return;
    const issue = result.error.issues.find((i) => i.path[0] === "segment");
    expect(issue?.message).toBe(cadastroMessages.errors.segment);
  });

  it("segmento ausente passa (opcional, ADR-002)", () => {
    const { segment: _sg, ...rest } = baseInput;
    expect(signupSchema.safeParse(rest).success).toBe(true);
  });

  it("sentinela vazia da UI vira ausência", () => {
    const result = signupSchema.safeParse({ ...baseInput, segment: "" });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.segment).toBeUndefined();
  });

  it("senhas diferentes falham", () => {
    const result = signupSchema.safeParse({
      ...baseInput,
      confirmPassword: "outra-senha-1",
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    const issue = result.error.issues.find(
      (i) => i.path[0] === "confirmPassword",
    );
    expect(issue?.message).toBe(cadastroMessages.errors.passwordMismatch);
  });
});
