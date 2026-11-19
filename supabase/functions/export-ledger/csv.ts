// CSV do export contábil (ADR-10): separador `;` (Excel pt-BR), RFC 4180 e
// neutralização de fórmula (CSV injection / CWE-1236). BOM fica por conta do
// handler (o conteúdo puro é testável sem BOM).
//
// Célula de texto que começa com `=`, `+`, `-`, `@`, TAB ou CR é prefixada com
// `'`; número puro (`-12,34`, `0.125`) não é fórmula e passa intacto. A mesma
// regra do `src/lib/retention-csv.ts` (fonte da verdade no cliente) — duplicada
// aqui porque a Edge não importa código do bundle.

import type { FiscalDoc, Movimento } from "./types.ts";
import { FISCAL_STATUS_LABEL } from "./types.ts";

const FORMULA_LEAD = /^[=+\-@\t\r]/;
const NUMERO_PURO = /^-?\d+(?:[.,]\d+)?$/;

export function sanitizeCsvCell(text: string): string {
  if (text === "" || NUMERO_PURO.test(text)) return text;
  return FORMULA_LEAD.test(text) ? `'${text}` : text;
}

export interface CsvColumn {
  header: string;
  value: (row: Movimento) => string | number;
}

export const CSV_COLUMNS: readonly CsvColumn[] = [
  { header: "Data", value: (row) => row.data },
  { header: "Tipo", value: (row) => row.tipo },
  { header: "Categoria", value: (row) => row.categoria },
  { header: "Descricao", value: (row) => row.descricao },
  { header: "Metodo", value: (row) => row.metodo },
  { header: "Valor_centavos", value: (row) => row.valor_cents },
  { header: "Gorjeta_centavos", value: (row) => row.gorjeta_cents },
  { header: "Valor_BRL", value: (row) => brl(row.valor_cents) },
];

/** Centavos → decimal pt-BR sem símbolo (`1234,56`). */
export function brl(cents: number): string {
  return (cents / 100).toFixed(2).replace(".", ",");
}

function escapeCell(value: string | number): string {
  const text = sanitizeCsvCell(String(value));
  if (/[";\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

export function buildCsv(rows: readonly Movimento[]): string {
  const header = CSV_COLUMNS.map((column) => escapeCell(column.header)).join(";");
  const lines = rows.map((row) =>
    CSV_COLUMNS.map((column) => escapeCell(column.value(row))).join(";"),
  );
  return [header, ...lines].join("\r\n") + "\r\n";
}

/** Converte documentos fiscais em linhas do CSV (escopo `fiscal`). */
export function fiscalToMovimentos(docs: readonly FiscalDoc[]): Movimento[] {
  return docs.map((doc) => {
    const numero = doc.numero ? `nº ${doc.numero}` : "sem número";
    const serie = doc.serie ? ` série ${doc.serie}` : "";
    const rotulo = FISCAL_STATUS_LABEL[doc.status] ?? doc.status;
    return {
      data: doc.data,
      tipo: "fiscal",
      categoria: "NFC-e",
      descricao: `NFC-e ${numero}${serie} — ${rotulo}`,
      metodo: "",
      valor_cents: doc.valor_cents,
      gorjeta_cents: 0,
    };
  });
}
