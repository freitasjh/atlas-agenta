// OFX do export contábil (ADR-10): extrato CONCILIADO do período.
//
// OFX 1.0.2 (SGML, UTF-8) com `BANKTRANLIST` + `LEDGERBAL`. Sem dependência de
// biblioteca: o formato é pequeno e o custo de uma lib não se paga.
//
// Saldos: abertura = saldo inicial das contas ativas + linhas conciliadas antes
// do período; fechamento = abertura + linhas exportadas. Portanto o extrato é
// internamente consistente e representa SOMENTE o que já foi conciliado —
// linha pendente/ignorada não entra no arquivo do contador.
//
// `escopo` NÃO filtra o OFX (decisão registrada no ADR-10): extrato é um só e a
// verdade é a conciliação. A UI avisa isso no formulário.

import type { BankLine, BankMeta } from "./types.ts";

const XML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&apos;",
};

export function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => XML_ESCAPES[char] ?? char);
}

/** `YYYY-MM-DD` → `YYYYMMDD` (formato de data do OFX). */
export function ofxDate(isoDate: string): string {
  return isoDate.slice(0, 10).replace(/-/g, "");
}

/** Centavos → decimal com ponto (`1234.56`), como o OFX exige. */
export function ofxAmount(cents: number): string {
  return (cents / 100).toFixed(2);
}

export interface OfxInput {
  periodoIni: string;
  periodoFim: string;
  lines: readonly BankLine[];
  openingCents: number;
  meta: BankMeta | null;
  /** Instante da geração (DTSERVER). Injetado para o teste ser determinístico. */
  generatedAt: Date;
}

export function buildOfx(input: OfxInput): string {
  const accountId = input.meta?.consolidado
    ? "CONSOLIDADO"
    : input.meta?.contaUltimos4 || "0000";
  const bankId = "00000000";
  const totalCents =
    input.openingCents + input.lines.reduce((total, line) => total + line.valor_cents, 0);
  const serverDate = input.generatedAt.toISOString().replace(/[-:T]/g, "").slice(0, 14);

  const transactions = input.lines
    .map((line) => {
      const tipo = line.valor_cents >= 0 ? "CREDIT" : "DEBIT";
      const memo = escapeXml(line.descricao.slice(0, 255));
      return [
        "<STMTTRN>",
        `<TRNTYPE>${tipo}</TRNTYPE>`,
        `<DTPOSTED>${ofxDate(line.data)}120000</DTPOSTED>`,
        `<TRNAMT>${ofxAmount(line.valor_cents)}</TRNAMT>`,
        `<FITID>${escapeXml(line.id)}</FITID>`,
        `<MEMO>${memo}</MEMO>`,
        "</STMTTRN>",
      ].join("");
    })
    .join("\n");

  return [
    "OFXHEADER:100",
    "DATA:OFXSGML",
    "VERSION:102",
    "SECURITY:NONE",
    "ENCODING:UTF-8",
    "CHARSET:NONE",
    "COMPRESSION:NONE",
    "OLDFILEUID:NONE",
    "NEWFILEUID:NONE",
    "",
    "<OFX>",
    "<SIGNONMSGSRSV1>",
    "<SONRS>",
    "<STATUS><CODE>0</CODE><SEVERITY>INFO</SEVERITY></STATUS>",
    `<DTSERVER>${serverDate}</DTSERVER>`,
    "<LANGUAGE>POR</LANGUAGE>",
    "<FI><ORG>Atlas Agenda</ORG><FID>0000</FID></FI>",
    "</SONRS>",
    "</SIGNONMSGSRSV1>",
    "<BANKMSGSRSV1>",
    "<STMTTRNRS>",
    "<TRNUID>1</TRNUID>",
    "<STATUS><CODE>0</CODE><SEVERITY>INFO</SEVERITY></STATUS>",
    "<STMTRS>",
    "<CURDEF>BRL</CURDEF>",
    "<BANKACCTFROM>",
    `<BANKID>${bankId}</BANKID>`,
    `<ACCTID>${escapeXml(accountId)}</ACCTID>`,
    "<ACCTTYPE>CHECKING</ACCTTYPE>",
    "</BANKACCTFROM>",
    "<BANKTRANLIST>",
    `<DTSTART>${ofxDate(input.periodoIni)}000000</DTSTART>`,
    `<DTEND>${ofxDate(input.periodoFim)}235959</DTEND>`,
    transactions,
    "</BANKTRANLIST>",
    "<LEDGERBAL>",
    `<BALAMT>${ofxAmount(totalCents)}</BALAMT>`,
    `<DTASOF>${ofxDate(input.periodoFim)}235959</DTASOF>`,
    "</LEDGERBAL>",
    "</STMTRS>",
    "</STMTTRNRS>",
    "</BANKMSGSRSV1>",
    "</OFX>",
  ].join("\n");
}
