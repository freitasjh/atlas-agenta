import { describe, expect, it } from "vitest";

import {
  buildDreCsv,
  comAcumulado,
  diaLabel,
  dreCsvFileName,
  dreErrorMessage,
  dreReportSchema,
  mesLabel,
  semMovimento,
  ultimosMeses,
  type DreMes,
  type DreReport,
} from "@/lib/dre";

const REPORT: DreReport = {
  regime: "competencia",
  ini: "2026-01-01T03:00:00.000Z",
  fim: "2026-02-01T03:00:00.000Z",
  receitas: {
    total_cents: 46_000,
    grupos: [
      { categoria: "Atendimentos", valor_cents: 30_000 },
      { categoria: "Receitas avulsas", valor_cents: 7_000 },
      { categoria: "Recorrência", valor_cents: 9_000 },
    ],
  },
  custos: { total_cents: 2_500, grupos: [{ categoria: "Comissões", valor_cents: 2_500 }] },
  margem_cents: 43_500,
  despesas: { total_cents: 4_000, grupos: [{ categoria: "aluguel", valor_cents: 4_000 }] },
  resultado_cents: 39_500,
  gorjeta_ignorada_cents: 3_000,
  meses: [
    { mes: "2026-01", receitas_cents: 46_000, custos_cents: 2_500, despesas_cents: 4_000, resultado_cents: 39_500 },
  ],
};

function mes(numero: number, resultado: number): DreMes {
  return {
    mes: `2026-${String(numero).padStart(2, "0")}`,
    receitas_cents: resultado,
    custos_cents: 0,
    despesas_cents: 0,
    resultado_cents: resultado,
  };
}

describe("dreReportSchema", () => {
  it("aceita a resposta da RPC e ignora gorjeta ausente (default 0)", () => {
    const parsed = dreReportSchema.parse({ ...REPORT, gorjeta_ignorada_cents: undefined });
    expect(parsed.receitas.total_cents).toBe(46_000);
    expect(parsed.gorjeta_ignorada_cents).toBe(0);
    expect(parsed.meses).toHaveLength(1);
  });

  it("recusa regime fora do contrato e valor fracionário de centavo", () => {
    expect(dreReportSchema.safeParse({ ...REPORT, regime: "misto" }).success).toBe(false);
    expect(
      dreReportSchema.safeParse({
        ...REPORT,
        receitas: { total_cents: 10.5, grupos: [] },
      }).success,
    ).toBe(false);
  });
});

describe("rótulos e séries", () => {
  it("formata mês e dia em pt-BR, preservando entrada inválida", () => {
    expect(mesLabel("2026-01")).toBe("jan/2026");
    expect(mesLabel("2026-12")).toBe("dez/2026");
    expect(mesLabel("inválido")).toBe("inválido");
    expect(diaLabel("2026-01-05")).toBe("05/01");
    expect(diaLabel("2026-01")).toBe("2026-01");
  });

  it("limita a 6 meses e acumula o resultado para a linha do gráfico", () => {
    const meses = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => mes(n, n * 100));
    const ultimos = ultimosMeses(meses, 6);
    expect(ultimos.map((m) => m.mes)).toEqual([
      "2026-03",
      "2026-04",
      "2026-05",
      "2026-06",
      "2026-07",
      "2026-08",
    ]);
    expect(comAcumulado(ultimos).map((linha) => linha.acumulado_cents)).toEqual([
      300, 700, 1200, 1800, 2500, 3300,
    ]);
    expect(ultimosMeses(meses, 0)).toEqual([]);
  });

  it("detecta período sem movimento (gorjeta sozinha não conta)", () => {
    expect(semMovimento(REPORT)).toBe(false);
    expect(
      semMovimento({
        ...REPORT,
        receitas: { total_cents: 0, grupos: [] },
        custos: { total_cents: 0, grupos: [] },
        despesas: { total_cents: 0, grupos: [] },
        margem_cents: 0,
        resultado_cents: 0,
        gorjeta_ignorada_cents: 3_000,
      }),
    ).toBe(true);
  });
});

describe("CSV do DRE", () => {
  it("segue a ordem da tabela, com decimais pt-BR e sem gorjeta como receita", () => {
    const csv = buildDreCsv(REPORT, "2026-01-01..2026-01-31");
    expect(csv.startsWith("Regime;Período;Seção;Categoria;Valor (R$)")).toBe(true);

    const linhas = csv.trim().split("\r\n");
    expect(linhas).toContain("Competência;2026-01-01..2026-01-31;Receitas;Total;460,00");
    expect(linhas).toContain("Competência;2026-01-01..2026-01-31;Receitas;Receitas avulsas;70,00");
    expect(linhas).toContain("Competência;2026-01-01..2026-01-31;Receitas;Recorrência;90,00");
    expect(linhas).toContain("Competência;2026-01-01..2026-01-31;Custos;Comissões;25,00");
    expect(linhas).toContain("Competência;2026-01-01..2026-01-31;Margem;Receitas − Custos;435,00");
    expect(linhas).toContain("Competência;2026-01-01..2026-01-31;Despesas;aluguel;40,00");
    expect(linhas).toContain("Competência;2026-01-01..2026-01-31;Resultado;Margem − Despesas;395,00");
    // Gorjeta não vira linha de receita (3.000 centavos não aparecem como 30,00).
    expect(csv).not.toContain(";Gorjetas;");
    // Escape RFC 4180 preservado pelo buildCsv.
    expect(dreCsvFileName("caixa", "2026-01-01T03:00:00.000Z", "2026-02-01T03:00:00.000Z")).toBe(
      "dre-caixa-2026-01-01_2026-02-01.csv",
    );
  });
});

describe("dreErrorMessage", () => {
  it("traduz os códigos estáveis da RPC", () => {
    expect(dreErrorMessage("FEATURE_DISABLED", "x")).toMatch(/plano/);
    expect(dreErrorMessage("FORBIDDEN", "x")).toMatch(/administrador/);
    expect(dreErrorMessage("RANGE_TOO_LARGE", "x")).toMatch(/longo demais/);
    expect(dreErrorMessage("INVALID_REGIME", "x")).toMatch(/Regime inválido/);
    expect(dreErrorMessage("INVALID_BODY", "x")).toMatch(/Período inválido/);
    expect(dreErrorMessage("OUTRO", "fallback")).toBe("fallback");
    expect(dreErrorMessage(null, "fallback")).toBe("fallback");
  });
});
