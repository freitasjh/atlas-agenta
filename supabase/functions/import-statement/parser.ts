// Parser de extrato bancário (OFX/CSV) da Edge `import-statement` (ADR-08, RF-22).
//
// Contrato: devolve LINHAS já normalizadas (data ISO, descrição, valor assinado em
// centavos) + período + saldos quando o arquivo os traz. Qualquer arquivo inválido
// lança `StatementParseError` com um código estável — a transação do import NÃO
// grava nada parcial: ou o arquivo inteiro é válido, ou zero linhas.
//
// Decisões:
//  - Centavos por aritmética inteira (nunca float): `1.234,56` → 123456.
//  - `,` decimal (pt-BR) e `.` decimal (OFX/en-US) são aceitos; `1.234` só é
//    milhar quando o último grupo tem exatamente 3 dígitos.
//  - CSV exige cabeçalho com data/descrição/valor (aceita variações comuns).
//  - Nada de PII em mensagem de erro: só o código estável.
//  - Limite duro de linhas (2000) e de tamanho do arquivo (2MB, checado no handler).

export interface StatementLine {
  /** ISO `yyyy-mm-dd` (UTC). */
  data: string;
  descricao: string;
  /** Assinado: crédito > 0, débito < 0. */
  valor_cents: number;
}

export interface ParsedStatement {
  lines: StatementLine[];
  periodo_ini: string;
  periodo_fim: string;
  saldo_ini_cents: number | null;
  saldo_fim_cents: number | null;
}

export const MAX_STATEMENT_LINES = 2_000;

export class StatementParseError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = "StatementParseError";
    this.code = code;
  }
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function assertIsoDate(iso: string): string {
  if (!ISO_DATE.test(iso)) throw new StatementParseError("STATEMENT_INVALID_DATE");
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  const probe = new Date(Date.UTC(y, m - 1, d));
  if (
    probe.getUTCFullYear() !== y ||
    probe.getUTCMonth() !== m - 1 ||
    probe.getUTCDate() !== d
  ) {
    throw new StatementParseError("STATEMENT_INVALID_DATE");
  }
  return iso;
}

/** `dd/mm/yyyy`, `dd-mm-yyyy` ou `yyyy-mm-dd` → ISO `yyyy-mm-dd`. */
export function parseDate(raw: string): string {
  const value = raw.trim();
  if (ISO_DATE.test(value)) return assertIsoDate(value);

  const br = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(value);
  if (br) {
    const day = Number(br[1]);
    const month = Number(br[2]);
    const year = Number(br[3]);
    const iso = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    return assertIsoDate(iso);
  }

  throw new StatementParseError("STATEMENT_INVALID_DATE");
}

/**
 * Valor monetário → centavos inteiros. Aceita `1.234,56`, `-1234.56`, `R$ 10,00`,
 * `(10,00)` (contábil negativo) e `1.234` (milhar sem centavos).
 */
export function parseAmountToCents(raw: string): number {
  let value = raw.trim();
  if (value === "") throw new StatementParseError("STATEMENT_INVALID_AMOUNT");

  let negative = false;
  if (/^\(.*\)$/.test(value)) {
    negative = true;
    value = value.slice(1, -1);
  }

  value = value
    .replace(/^R\$\s*/i, "")
    .replace(/\s+/g, "")
    .replace(/[+-]$/, (signal) => {
      if (signal === "-") negative = true;
      return "";
    });

  if (value.startsWith("-")) {
    negative = true;
    value = value.slice(1);
  } else if (value.startsWith("+")) {
    value = value.slice(1);
  }

  if (!/^[0-9.,]+$/.test(value) || !/[0-9]/.test(value)) {
    throw new StatementParseError("STATEMENT_INVALID_AMOUNT");
  }

  let normalized: string;
  const lastComma = value.lastIndexOf(",");
  const lastDot = value.lastIndexOf(".");

  if (lastComma >= 0 && lastDot >= 0) {
    // O separador decimal é o ÚLTIMO que aparece.
    const decimalSep = lastComma > lastDot ? "," : ".";
    const thousandSep = decimalSep === "," ? "." : ",";
    normalized = value.split(thousandSep).join("").replace(decimalSep, ".");
  } else if (lastComma >= 0) {
    const pieces = value.split(",");
    if (pieces.length > 2) {
      // 1.234,56 já caiu no ramo acima; aqui `1,234,567` é milhar.
      normalized = pieces.join("");
    } else {
      normalized = `${pieces[0] ?? ""}.${pieces[1] ?? ""}`;
    }
  } else if (lastDot >= 0) {
    const pieces = value.split(".");
    const last = pieces[pieces.length - 1];
    if (pieces.length > 2 || (last.length === 3 && pieces.length === 2 && pieces[0].length <= 3)) {
      // 1.234.567 ou 1.234 → milhar (dinheiro nunca tem 3 casas).
      normalized = pieces.join("");
    } else {
      normalized = `${pieces.slice(0, -1).join("")}.${last}`;
    }
  } else {
    normalized = value;
  }

  const [intPart, decPart = ""] = normalized.split(".");
  if (intPart === "" || !/^\d+$/.test(intPart)) {
    throw new StatementParseError("STATEMENT_INVALID_AMOUNT");
  }
  if (decPart.length > 2 || !/^\d*$/.test(decPart)) {
    throw new StatementParseError("STATEMENT_INVALID_AMOUNT");
  }

  const cents = Number(intPart) * 100 + Number(decPart.padEnd(2, "0"));
  if (!Number.isSafeInteger(cents) || cents > 2_147_483_647) {
    throw new StatementParseError("STATEMENT_INVALID_AMOUNT");
  }

  return negative ? -cents : cents;
}

function decodeEntities(raw: string): string {
  return raw
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'");
}

function tag(block: string, name: string): string | null {
  const match = new RegExp(`<${name}>([^<\\r\\n]*)`, "i").exec(block);
  if (!match) return null;
  const value = decodeEntities(match[1] ?? "").trim();
  return value === "" ? null : value;
}

function finish(lines: StatementLine[], saldoIni: number | null, saldoFim: number | null): ParsedStatement {
  if (lines.length === 0) throw new StatementParseError("STATEMENT_EMPTY");
  if (lines.length > MAX_STATEMENT_LINES) throw new StatementParseError("STATEMENT_TOO_MANY_LINES");

  const dates = lines.map((line) => line.data).sort();
  return {
    lines,
    periodo_ini: dates[0] as string,
    periodo_fim: dates[dates.length - 1] as string,
    saldo_ini_cents: saldoIni,
    saldo_fim_cents: saldoFim,
  };
}

/** OFX (SGML ou XML): blocos `<STMTTRN>` + saldo `<LEDGERBAL>`. */
export function parseOfx(content: string): ParsedStatement {
  const blocks = [...content.matchAll(/<STMTTRN>([\s\S]*?)<\/STMTTRN>/gi)].map((m) => m[1] ?? "");
  if (blocks.length === 0) throw new StatementParseError("STATEMENT_EMPTY");

  const lines: StatementLine[] = [];
  for (const block of blocks) {
    const amountRaw = tag(block, "TRNAMT");
    const dateRaw = tag(block, "DTPOSTED");
    if (amountRaw === null) throw new StatementParseError("STATEMENT_INVALID_AMOUNT");
    if (dateRaw === null) throw new StatementParseError("STATEMENT_INVALID_DATE");

    const dateIso = parseOfxDate(dateRaw);
    const descricao = tag(block, "MEMO") ?? tag(block, "NAME") ?? "Lançamento bancário";
    lines.push({
      data: dateIso,
      descricao: descricao.slice(0, 255),
      valor_cents: parseAmountToCents(amountRaw),
    });
  }

  let saldo: number | null = null;
  const ledger = /<LEDGERBAL>([\s\S]*?)<\/LEDGERBAL>/i.exec(content)?.[1] ?? null;
  if (ledger !== null) {
    const balance = tag(ledger, "BALAMT");
    if (balance !== null) saldo = parseAmountToCents(balance);
  }

  // Saldo inicial explícito não existe no OFX: o ledger é o saldo final do extrato.
  return finish(lines, null, saldo);
}

/** `yyyymmdd[hhmmss[.xxx[+/-tz]]]` → ISO. */
function parseOfxDate(raw: string): string {
  const digits = raw.trim().replace(/[^0-9]/g, "");
  const match = /^(\d{4})(\d{2})(\d{2})/.exec(digits);
  if (!match) throw new StatementParseError("STATEMENT_INVALID_DATE");
  return assertIsoDate(`${match[1]}-${match[2]}-${match[3]}`);
}

const HEADER_ALIASES = {
  data: ["data", "date", "dt", "data mov", "data movimento", "data lancamento"],
  descricao: ["descricao", "descrição", "historico", "histórico", "memo", "lancamento", "lançamento", "description"],
  valor: ["valor", "amount", "valor (r$)", "valor r$", "vlr"],
} as const;

function normalizeHeader(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ");
}

function findColumn(header: string[], field: keyof typeof HEADER_ALIASES): number {
  const aliases = HEADER_ALIASES[field].map(normalizeHeader);
  return header.findIndex((cell) => aliases.includes(normalizeHeader(cell)));
}

/**
 * Divide uma linha de CSV em células com suporte RFC 4180 mínimo: campo entre
 * aspas pode conter o separador (`;"Loja A; B";`) e aspas escapadas (`""`).
 * Quebra de linha DENTRO de campo quotado não é suportada — cada registro deve
 * ocupar uma linha (limite declarado do parser).
 */
function splitCsvRow(row: string, delimiter: string): string[] {
  const cells: string[] = [];
  let current = "";
  let quoted = false;

  for (let i = 0; i < row.length; i += 1) {
    const char = row[i] as string;
    if (quoted) {
      if (char === '"') {
        if (row[i + 1] === '"') {
          current += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        current += char;
      }
      continue;
    }
    if (char === '"' && current.trim() === "") {
      quoted = true;
      current = "";
      continue;
    }
    if (char === delimiter) {
      cells.push(current);
      current = "";
      continue;
    }
    current += char;
  }

  if (quoted) throw new StatementParseError("STATEMENT_INVALID_ROW");
  cells.push(current);
  return cells;
}

/** CSV: cabeçalho obrigatório com data/descrição/valor; `;` ou `,` como separador. */
export function parseCsv(content: string): ParsedStatement {
  const clean = content.replace(/^\uFEFF/, "");
  const rawLines = clean.split(/\r?\n/).filter((line) => line.trim() !== "");
  if (rawLines.length === 0) throw new StatementParseError("STATEMENT_EMPTY");

  const headerLine = rawLines[0] as string;
  const semicolons = (headerLine.match(/;/g) ?? []).length;
  const commas = (headerLine.match(/,/g) ?? []).length;
  const delimiter = semicolons >= commas ? ";" : ",";

  const header = splitCsvRow(headerLine, delimiter);
  const dataIndex = findColumn(header, "data");
  const descricaoIndex = findColumn(header, "descricao");
  const valorIndex = findColumn(header, "valor");
  if (dataIndex < 0 || descricaoIndex < 0 || valorIndex < 0) {
    throw new StatementParseError("STATEMENT_INVALID_HEADER");
  }

  const lines: StatementLine[] = [];
  for (const row of rawLines.slice(1)) {
    const cells = splitCsvRow(row, delimiter);
    const dataRaw = (cells[dataIndex] ?? "").trim();
    const descricaoRaw = (cells[descricaoIndex] ?? "").trim();
    const valorRaw = (cells[valorIndex] ?? "").trim();
    if (dataRaw === "" && descricaoRaw === "" && valorRaw === "") continue;
    if (dataRaw === "" || valorRaw === "") throw new StatementParseError("STATEMENT_INVALID_ROW");

    lines.push({
      data: parseDate(dataRaw),
      descricao: (descricaoRaw === "" ? "Lançamento bancário" : descricaoRaw).slice(0, 255),
      valor_cents: parseAmountToCents(valorRaw),
    });
  }

  return finish(lines, null, null);
}

export function parseStatement(formato: "ofx" | "csv", content: string): ParsedStatement {
  if (formato === "ofx") return parseOfx(content);
  if (formato === "csv") return parseCsv(content);
  throw new StatementParseError("STATEMENT_UNSUPPORTED_FORMAT");
}
