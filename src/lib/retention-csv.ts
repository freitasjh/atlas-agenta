/**
 * Export CSV client-side dos relatórios de retenção (ADR-17 §5: sem endpoint
 * novo — o CSV é gerado a partir do JSON já retornado pela RPC).
 * Separador `;` (Excel pt-BR), valores com `\n`/`"` escapados (RFC 4180).
 *
 * Célula de texto que começa com `=`, `+`, `-`, `@`, TAB ou CR é prefixada com
 * `'`: sem isso a planilha interpreta o conteúdo como fórmula (CSV injection,
 * OWASP). Número puro (`-12,34`, `0.125`) não é fórmula e passa intacto.
 */

export interface CsvColumn<T> {
  header: string;
  value: (row: T) => string | number;
}

const FORMULA_LEAD = /^[=+\-@\t\r]/;
const NUMERO_PURO = /^-?\d+(?:[.,]\d+)?$/;

/** Neutraliza fórmula em célula de texto; número puro nunca é prefixado. */
export function sanitizeCsvCell(text: string): string {
  if (text === "" || NUMERO_PURO.test(text)) return text;
  return FORMULA_LEAD.test(text) ? `'${text}` : text;
}

export function buildCsv<T>(rows: T[], columns: CsvColumn<T>[]): string {
  const escape = (cell: string | number): string => {
    const text = sanitizeCsvCell(String(cell));
    if (/[";\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
    return text;
  };
  const header = columns.map((col) => escape(col.header)).join(";");
  const lines = rows.map((row) =>
    columns.map((col) => escape(col.value(row))).join(";"),
  );
  return [header, ...lines].join("\r\n") + "\r\n";
}

export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}
