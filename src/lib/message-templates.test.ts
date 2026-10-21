import { describe, expect, it } from "vitest";

import {
  renderTemplate,
  TEMPLATE_FALLBACKS,
  TEMPLATE_VARIABLES,
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
