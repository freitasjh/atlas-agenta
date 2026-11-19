// Parser OFX/CSV da importação de extrato (ADR-08, RF-22).
//
// O que este teste protege: centavos por aritmética inteira, datas BR/ISO,
// arquivo inválido com código estável (nunca linha parcial) e leitura de saldo
// do OFX. Nenhum caso depende de banco ou rede.
import { deepStrictEqual, strictEqual, throws } from "node:assert/strict";
import {
  parseAmountToCents,
  parseCsv,
  parseDate,
  parseOfx,
  StatementParseError,
} from "./parser.ts";

function assertCode(fn: () => unknown, code: string): void {
  throws(fn, (error: unknown) => error instanceof StatementParseError && error.code === code);
}

const OFX = `OFXHEADER:100
DATA:OFXSGML

<OFX>
<BANKMSGSRSV1>
<STMTTRNRS>
<STMTRS>
<BANKTRANLIST>
<DTSTART>20260101
<DTEND>20260131
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20260105120000[-3:BRT]
<TRNAMT>-150.00
<FITID>1
<MEMO>Pagamento fornecedor
</STMTTRN>
<STMTTRN>
<TRNTYPE>CREDIT
<DTPOSTED>20260110
<TRNAMT>1234.56
<FITID>2
<NAME>Recebimento PIX &amp; cartão
</STMTTRN>
</BANKTRANLIST>
<LEDGERBAL>
<BALAMT>1084.56
<DTASOF>20260131
</LEDGERBAL>
</STMTRS>
</STMTTRNRS>
</BANKMSGSRSV1>
</OFX>`;

const CSV = `data;descricao;valor
05/01/2026;Pagamento fornecedor;-150,00
10/01/2026;Recebimento PIX;1.234,56`;

Deno.test("valores: pt-BR, OFX, contábil negativo e milhar", () => {
  strictEqual(parseAmountToCents("1.234,56"), 123_456);
  strictEqual(parseAmountToCents("-1.234,56"), -123_456);
  strictEqual(parseAmountToCents("-1234.56"), -123_456);
  strictEqual(parseAmountToCents("R$ 10,00"), 1_000);
  strictEqual(parseAmountToCents("(10,00)"), -1_000);
  strictEqual(parseAmountToCents("1.234"), 123_400);
  strictEqual(parseAmountToCents("1234"), 123_400);
  strictEqual(parseAmountToCents("0,05"), 5);
  assertCode(() => parseAmountToCents("abc"), "STATEMENT_INVALID_AMOUNT");
  assertCode(() => parseAmountToCents("1,2345"), "STATEMENT_INVALID_AMOUNT");
});

Deno.test("datas: BR e ISO; data impossível é recusada", () => {
  strictEqual(parseDate("01/02/2026"), "2026-02-01");
  strictEqual(parseDate("1/2/2026"), "2026-02-01");
  strictEqual(parseDate("2026-02-01"), "2026-02-01");
  assertCode(() => parseDate("31/02/2026"), "STATEMENT_INVALID_DATE");
  assertCode(() => parseDate("2026-13-01"), "STATEMENT_INVALID_DATE");
  assertCode(() => parseDate("ontem"), "STATEMENT_INVALID_DATE");
});

Deno.test("OFX: linhas, período, saldo do LEDGERBAL e entidades", () => {
  const ofx = parseOfx(OFX);
  strictEqual(ofx.lines.length, 2);
  deepStrictEqual(ofx.lines[0], {
    data: "2026-01-05",
    descricao: "Pagamento fornecedor",
    valor_cents: -15_000,
  });
  deepStrictEqual(ofx.lines[1], {
    data: "2026-01-10",
    descricao: "Recebimento PIX & cartão",
    valor_cents: 123_456,
  });
  strictEqual(ofx.periodo_ini, "2026-01-05");
  strictEqual(ofx.periodo_fim, "2026-01-10");
  strictEqual(ofx.saldo_fim_cents, 108_456);
  strictEqual(ofx.saldo_ini_cents, null);
});

Deno.test("OFX inválido: vazio, valor e data têm código estável", () => {
  assertCode(() => parseOfx("<OFX></OFX>"), "STATEMENT_EMPTY");
  assertCode(
    () => parseOfx(`<STMTTRN><DTPOSTED>20260105<TRNAMT>abc</STMTTRN>`),
    "STATEMENT_INVALID_AMOUNT",
  );
  assertCode(
    () => parseOfx(`<STMTTRN><TRNAMT>10.00<DTPOSTED>20261340</STMTTRN>`),
    "STATEMENT_INVALID_DATE",
  );
});

Deno.test("CSV: campo quotado aceita separador e aspas escapadas (RFC 4180 mínimo)", () => {
  const quoted = parseCsv(
    `"data";"descricao";"valor"\n` +
      `"05/01/2026";"Compra ""Loja A; B""";"-150,00"\n` +
      `10/01/2026;Recebimento PIX;1234,56`,
  );
  deepStrictEqual(quoted.lines, [
    { data: "2026-01-05", descricao: `Compra "Loja A; B"`, valor_cents: -15_000 },
    { data: "2026-01-10", descricao: "Recebimento PIX", valor_cents: 123_456 },
  ]);

  assertCode(
    () => parseCsv(`data;descricao;valor\n05/01/2026;"Campo aberto;10,00`),
    "STATEMENT_INVALID_ROW",
  );
});

Deno.test("CSV: ponto e vírgula, vírgula, cabeçalho e linha inválida", () => {
  const csv = parseCsv(CSV);
  deepStrictEqual(csv.lines, [
    { data: "2026-01-05", descricao: "Pagamento fornecedor", valor_cents: -15_000 },
    { data: "2026-01-10", descricao: "Recebimento PIX", valor_cents: 123_456 },
  ]);
  strictEqual(csv.periodo_ini, "2026-01-05");
  strictEqual(csv.periodo_fim, "2026-01-10");

  const commaCsv = parseCsv(`Date,Description,Amount\n2026-01-05,Aluguel,-1200.00`);
  strictEqual(commaCsv.lines[0]?.valor_cents, -120_000);
  strictEqual(commaCsv.lines[0]?.descricao, "Aluguel");

  assertCode(() => parseCsv(""), "STATEMENT_EMPTY");
  assertCode(() => parseCsv("data;valor\n01/01/2026;10,00"), "STATEMENT_INVALID_HEADER");
  assertCode(
    () => parseCsv("data;descricao;valor\n05/01/2026;Sem valor;"),
    "STATEMENT_INVALID_ROW",
  );
  assertCode(() => parseCsv("data;descricao;valor\ntexto;X;10,00"), "STATEMENT_INVALID_DATE");
  assertCode(() => parseCsv("data;descricao;valor\n"), "STATEMENT_EMPTY");
});
