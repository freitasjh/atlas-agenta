import { describe, expect, it } from "vitest";

import {
  renderTemplate,
  resolveEmpresa,
  segmentTemplate,
  TEMPLATE_FALLBACKS,
  TEMPLATE_VARIABLES,
  type TemplateVars,
} from "@/lib/message-templates";

/**
 * Cobertura do contrato de renderização compartilhado (ADR-03). Casos derivados
 * dos critérios RNF-T05 / AC-05 / AC-06 do PRD. Peça pura: sem rede/relógio.
 */

describe("renderTemplate", () => {
  it("AC-05: substitui as 4 variáveis quando os dados existem", () => {
    const body = "Olá {nome}, seu horário de {servico} é {dataHora}. — {empresa}";
    const out = renderTemplate(body, {
      nome: "Ana",
      servico: "Corte",
      dataHora: "10/03 às 14:00",
      empresa: "Studio Lux",
    });
    expect(out).toBe("Olá Ana, seu horário de Corte é 10/03 às 14:00. — Studio Lux");
  });

  it("AC-06: variável faltante cai no fallback pt-BR, nunca no placeholder cru", () => {
    const body = "Olá {nome}, seu {servico} é {dataHora}. — {empresa}";
    const out = renderTemplate(body, {});
    expect(out).toBe(
      "Olá cliente, seu seu atendimento é no horário combinado. — nossa equipe",
    );
    // Nenhuma variável conhecida sai crua.
    for (const variable of TEMPLATE_VARIABLES) {
      expect(out).not.toContain(`{${variable}}`);
    }
  });

  it("AC-06: valor null ou vazio também aciona o fallback", () => {
    const body = "{nome} / {empresa}";
    expect(renderTemplate(body, { nome: null, empresa: "" })).toBe(
      `${TEMPLATE_FALLBACKS.nome} / ${TEMPLATE_FALLBACKS.empresa}`,
    );
    // Valor só com espaços é tratado como vazio.
    expect(renderTemplate("{nome}", { nome: "   " })).toBe(
      TEMPLATE_FALLBACKS.nome,
    );
  });

  it("empresa nula usa 'nossa equipe' (fallback de {empresa})", () => {
    expect(renderTemplate("{empresa}", { empresa: null })).toBe("nossa equipe");
    expect(renderTemplate("{empresa}", { empresa: "ACME" })).toBe("ACME");
  });

  it("token desconhecido é mantido literal", () => {
    expect(renderTemplate("Oi {foo} e {nome}", { nome: "Ana" })).toBe(
      "Oi {foo} e Ana",
    );
    // Sem dados: desconhecido literal, conhecido no fallback.
    expect(renderTemplate("{foo} {nome}", {})).toBe("{foo} cliente");
  });

  it("texto sem variáveis é devolvido intacto", () => {
    expect(renderTemplate("Mensagem simples 1 confirmar / 2 reagendar", {})).toBe(
      "Mensagem simples 1 confirmar / 2 reagendar",
    );
  });

  it("variável repetida é substituída em todas as ocorrências", () => {
    expect(renderTemplate("{nome} {nome}", { nome: "Ana" })).toBe("Ana Ana");
  });

  it("RNF-T05: determinístico — mesma entrada, mesma saída", () => {
    const body = "Olá {nome}, {servico} em {dataHora}";
    const vars = { nome: "Ana", servico: "Corte", dataHora: "hoje" };
    expect(renderTemplate(body, vars)).toBe(renderTemplate(body, vars));
  });
});

/**
 * Cobertura da peça de segmentação compartilhada (ADR-07): preview do editor e
 * do `SendMessageDialog` reusam `segmentTemplate`. Invariante central: concatenar
 * os valores dos segmentos reproduz EXATAMENTE a saída de `renderTemplate` — o
 * realce não pode divergir do texto canônico enviado.
 */
describe("segmentTemplate", () => {
  const joinSegments = (body: string, vars: TemplateVars) =>
    segmentTemplate(body, vars)
      .map((segment) => segment.value)
      .join("");

  it("concatenação dos segmentos == renderTemplate (dados completos)", () => {
    const body = "Olá {nome}, seu {servico} é {dataHora}. — {empresa}";
    const vars = {
      nome: "Ana",
      servico: "Corte",
      dataHora: "10/03 às 14:00",
      empresa: "Studio Lux",
    };
    expect(joinSegments(body, vars)).toBe(renderTemplate(body, vars));
  });

  it("concatenação dos segmentos == renderTemplate (fallback + token desconhecido)", () => {
    const body = "Oi {nome}, {foo} em {dataHora}";
    const vars = {};
    expect(joinSegments(body, vars)).toBe(renderTemplate(body, vars));
    expect(renderTemplate(body, vars)).toBe(
      "Oi cliente, {foo} em no horário combinado",
    );
  });

  it("marca variáveis conhecidas como `var` e o resto como `text`", () => {
    const segments = segmentTemplate("Olá {nome}! {foo}", { nome: "Ana" });
    expect(segments).toEqual([
      { kind: "text", value: "Olá " },
      { kind: "var", value: "Ana" },
      { kind: "text", value: "! {foo}" },
    ]);
  });

  it("variável sem dado vira segmento `var` com o fallback (nunca token cru)", () => {
    const segments = segmentTemplate("{empresa}", { empresa: null });
    expect(segments).toEqual([{ kind: "var", value: "nossa equipe" }]);
  });

  it("corpo sem variáveis conhecidas é um único segmento de texto", () => {
    expect(segmentTemplate("1 confirmar / 2 reagendar {foo}", {})).toEqual([
      { kind: "text", value: "1 confirmar / 2 reagendar {foo}" },
    ]);
  });
});

/**
 * `resolveEmpresa` espelha o encadeamento do servidor (`resolveRenderedText`):
 * trade_name → legal_name → null. Garante preview == texto enviado para
 * `{empresa}` (defeito corrigido na reiteração da ADR-07).
 */
describe("resolveEmpresa", () => {
  it("usa trade_name quando preenchido", () => {
    expect(resolveEmpresa("Studio Lux", "Studio Lux ME")).toBe("Studio Lux");
  });

  it("cai para legal_name quando trade_name é nulo/vazio/espaços", () => {
    expect(resolveEmpresa(null, "Studio Lux ME")).toBe("Studio Lux ME");
    expect(resolveEmpresa("", "Studio Lux ME")).toBe("Studio Lux ME");
    expect(resolveEmpresa("   ", "Studio Lux ME")).toBe("Studio Lux ME");
  });

  it("devolve null quando ambos faltam (fallback 'nossa equipe' no render)", () => {
    expect(resolveEmpresa(null, null)).toBeNull();
    expect(resolveEmpresa(undefined, undefined)).toBeNull();
    expect(renderTemplate("{empresa}", { empresa: resolveEmpresa("", "") })).toBe(
      "nossa equipe",
    );
  });
});
