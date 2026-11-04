import { describe, expect, it } from "vitest";

import {
  maskCep,
  maskDocument,
  maskPhone,
  stripDigits,
} from "@/lib/mask";

/**
 * FE-01 — máscaras de apresentação do cadastro rico (ADR-003).
 *
 * Máscara é apresentação; o canônico (só dígitos) é derivado por `stripDigits`
 * no submit. Os testes provam: formatação progressiva (digitação parcial não
 * quebra), colar formatado, apagar (string menor continua válida) e strip puro.
 * Nenhum dado real aqui — só dígitos fictícios de teste.
 */

describe("stripDigits", () => {
  it("remove máscara e ignora não-string", () => {
    expect(stripDigits("12.345.678/0001-81")).toBe("12345678000181");
    expect(stripDigits("(11) 98765-4321")).toBe("11987654321");
    expect(stripDigits("01310-100")).toBe("01310100");
    expect(stripDigits(123 as unknown as string)).toBe("");
    expect(stripDigits(undefined as unknown as string)).toBe("");
  });

  it("nunca usa \\d (dígitos unicode não passam)", () => {
    expect(stripDigits("١٢٣")).toBe("");
  });
});

describe("maskDocument — dinâmica CPF/CNPJ", () => {
  it("formata CPF progressivo sem travar digitação parcial", () => {
    expect(maskDocument("5")).toBe("5");
    expect(maskDocument("529")).toBe("529");
    expect(maskDocument("5299")).toBe("529.9");
    expect(maskDocument("529982247")).toBe("529.982.247");
    expect(maskDocument("5299822472")).toBe("529.982.247-2");
    expect(maskDocument("52998224725")).toBe("529.982.247-25");
  });

  it("vira CNPJ a partir do 12º dígito", () => {
    expect(maskDocument("112223330001")).toBe("11.222.333/0001");
    expect(maskDocument("11222333000181")).toBe("11.222.333/0001-81");
  });

  it("aceita colar formatado (re-mascara idempotente)", () => {
    expect(maskDocument("529.982.247-25")).toBe("529.982.247-25");
    expect(maskDocument("11.222.333/0001-81")).toBe("11.222.333/0001-81");
  });

  it("apagar volta para a forma parcial sem resto de máscara", () => {
    expect(maskDocument("5299822472")).toBe("529.982.247-2");
    expect(maskDocument("52998224")).toBe("529.982.24");
  });

  it("limita a 14 dígitos", () => {
    expect(stripDigits(maskDocument("1122233300018199"))).toBe(
      "11222333000181",
    );
  });
});

describe("maskPhone — 10/11 dígitos", () => {
  it("formata progressivo sem travar digitação parcial", () => {
    expect(maskPhone("1")).toBe("(1");
    expect(maskPhone("11")).toBe("(11");
    expect(maskPhone("119")).toBe("(11) 9");
    expect(maskPhone("1198765432")).toBe("(11) 9876-5432");
    expect(maskPhone("11987654321")).toBe("(11) 98765-4321");
  });

  it("fixo 10 dígitos sem o 9 extra", () => {
    expect(maskPhone("1133334444")).toBe("(11) 3333-4444");
  });

  it("aceita colar formatado", () => {
    expect(maskPhone("(11) 98765-4321")).toBe("(11) 98765-4321");
  });

  it("limita a 11 dígitos", () => {
    expect(stripDigits(maskPhone("1198765432199"))).toBe("11987654321");
  });
});

describe("maskCep — 00000-000", () => {
  it("formata progressivo", () => {
    expect(maskCep("0")).toBe("0");
    expect(maskCep("01310")).toBe("01310");
    expect(maskCep("013101")).toBe("01310-1");
    expect(maskCep("01310100")).toBe("01310-100");
  });

  it("aceita colar formatado", () => {
    expect(maskCep("01310-100")).toBe("01310-100");
  });

  it("limita a 8 dígitos", () => {
    expect(stripDigits(maskCep("0131010099"))).toBe("01310100");
  });
});
