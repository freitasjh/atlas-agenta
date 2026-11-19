// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";

import { buildCsv, downloadCsv } from "@/lib/retention-csv";

describe("retention-csv", () => {
  it("gera cabeçalho + linhas com separador ponto-e-vírgula", () => {
    const csv = buildCsv(
      [{ label: "Ana", rate: 0.125 }],
      [
        { header: "Grupo", value: (row) => row.label },
        { header: "Taxa %", value: (row) => String(row.rate) },
      ],
    );
    expect(csv).toBe("Grupo;Taxa %\r\nAna;0.125\r\n");
  });

  it("escapa ponto-e-vírgula, aspas e quebra de linha", () => {
    const csv = buildCsv([{ label: 'A;B"C\nD' }], [
      { header: "Grupo", value: (row) => row.label },
    ]);
    expect(csv).toBe('Grupo\r\n"A;B""C\nD"\r\n');
  });

  it("neutraliza fórmula em célula de texto (CSV injection)", () => {
    const csv = buildCsv(
      [
        { label: "=SUM(A1)" },
        { label: "+55 11 99999-0000" },
        { label: "-descrição" },
        { label: "@import" },
        { label: "\tvalor" },
      ],
      [{ header: "Grupo", value: (row) => row.label }],
    );
    const linhas = csv.trim().split("\r\n").slice(1);
    expect(linhas[0]).toBe("'=SUM(A1)");
    expect(linhas[1]).toBe("'+55 11 99999-0000");
    expect(linhas[2]).toBe("'-descrição");
    expect(linhas[3]).toBe("'@import");
    expect(linhas[4].startsWith("'\t")).toBe(true);
  });

  it("número puro (inclusive negativo decimal) não ganha prefixo", () => {
    const csv = buildCsv(
      [{ valor: "-12,34", taxa: "0.125" }],
      [
        { header: "Valor", value: (row) => row.valor },
        { header: "Taxa", value: (row) => row.taxa },
      ],
    );
    expect(csv).toBe("Valor;Taxa\r\n-12,34;0.125\r\n");
  });

  it("retorna só cabeçalho quando não há linhas", () => {
    const csv = buildCsv([], [{ header: "Grupo", value: () => "x" }]);
    expect(csv).toBe("Grupo\r\n");
  });

  it("monta conteúdo CSV de ticket com vírgula decimal pt-BR", () => {
    const csv = buildCsv(
      [{ label: "Período", ticket_medio_cents: 8000, total_cents: 80000, appointment_count: 10 }],
      [
        { header: "Grupo", value: (row) => row.label },
        {
          header: "Ticket médio (R$)",
          value: (row) => (row.ticket_medio_cents / 100).toFixed(2).replace(".", ","),
        },
        { header: "Atendimentos", value: (row) => row.appointment_count },
      ],
    );
    expect(csv).toBe("Grupo;Ticket médio (R$);Atendimentos\r\nPeríodo;80,00;10\r\n");
  });

  it("downloadCsv dispara download com BOM e revoga a URL", () => {
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});
    const createSpy = vi
      .spyOn(URL, "createObjectURL")
      .mockImplementation((() => "blob:csv") as typeof URL.createObjectURL);
    const revokeSpy = vi
      .spyOn(URL, "revokeObjectURL")
      .mockImplementation(() => {});

    downloadCsv("relatorio.csv", "Grupo\r\nAna\r\n");

    expect(createSpy).toHaveBeenCalledTimes(1);
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(revokeSpy).toHaveBeenCalledWith("blob:csv");

    clickSpy.mockRestore();
    createSpy.mockRestore();
    revokeSpy.mockRestore();
  });
});
