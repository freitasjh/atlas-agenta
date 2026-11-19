import { describe, expect, it } from "vitest";

import {
  EXPORT_ESCOPO_META,
  EXPORT_FORMATO_META,
  exportErrorMessage,
  exportFileName,
  formatExportDate,
  parseContentDispositionFilename,
  toExportLogs,
} from "@/lib/export-contabil";

describe("export contábil — helpers puros (ADR-10)", () => {
  it("nome do arquivo segue o contrato da Edge", () => {
    expect(exportFileName("csv", "receber", "2026-01-01", "2026-01-31")).toBe(
      "export-receber-csv-2026-01-01_2026-01-31.csv",
    );
    expect(exportFileName("ofx", "pagar", "2026-01-01", "2026-01-31")).toBe(
      "export-pagar-ofx-2026-01-01_2026-01-31.ofx",
    );
    expect(exportFileName("sped", "fiscal", "2026-01-01", "2026-01-31")).toBe(
      "export-fiscal-sped-2026-01-01_2026-01-31.txt",
    );
  });

  it("SPED é rotulado como gerencial, nunca como fiscal válido", () => {
    expect(EXPORT_FORMATO_META.sped.rotulo).toBe("SPED-resumo (gerencial)");
    expect(EXPORT_FORMATO_META.sped.descricao.toLowerCase()).toContain("não substitui");
    expect(EXPORT_ESCOPO_META.fiscal.rotulo).toBe("Fiscal");
  });

  it("lê filename do Content-Disposition (com e sem aspas)", () => {
    expect(
      parseContentDispositionFilename('attachment; filename="export-receber-csv-2026-01-01_2026-01-31.csv"'),
    ).toBe("export-receber-csv-2026-01-01_2026-01-31.csv");
    expect(parseContentDispositionFilename("attachment; filename=arquivo.ofx")).toBe("arquivo.ofx");
    expect(parseContentDispositionFilename(null)).toBeNull();
  });

  it("traduz códigos estáveis da Edge", () => {
    expect(exportErrorMessage("EMPTY_PERIOD", "x")).toContain("Sem movimentos no período");
    expect(exportErrorMessage("FEATURE_DISABLED", "x")).toContain("plano atual");
    expect(exportErrorMessage("FORBIDDEN", "x")).toContain("administrador");
    expect(exportErrorMessage("RANGE_TOO_LARGE", "x")).toContain("12 meses");
    expect(exportErrorMessage("QUALQUER", "fallback")).toBe("fallback");
  });

  it("formata data e monta logs com nome do autor", () => {
    expect(formatExportDate("2026-01-31T12:00:00.000Z")).toMatch(/\d{2}\/\d{2}\/\d{4}/);

    const logs = toExportLogs(
      [
        {
          id: "l1",
          tipo: "ledger",
          periodo: "2026-01-01..2026-01-31",
          formato: "csv",
          arquivo_path: "export-receber-csv-2026-01-01_2026-01-31.csv",
          created_by: "u1",
          created_at: "2026-02-01T10:00:00.000Z",
        },
      ],
      new Map([["u1", "Ana Admin"]]),
    );
    expect(logs).toHaveLength(1);
    expect(logs[0].autorNome).toBe("Ana Admin");
    expect(logs[0].arquivoPath).toContain("export-receber-csv");
    expect(toExportLogs([{ id: 1 }], new Map())).toEqual([]);
  });
});
