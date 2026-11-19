// Builders do export contábil (ADR-10): CSV (RFC 4180 + CWE-1236), OFX
// (transações + saldos) e SPED-resumo (blocos E1xx gerenciais).
import { deepStrictEqual, strictEqual } from "node:assert/strict";
import { buildCsv, fiscalToMovimentos, sanitizeCsvCell } from "./csv.ts";
import { buildOfx, ofxAmount, ofxDate, escapeXml } from "./ofx.ts";
import { agregarCategorias, agregarFiscal, buildSped, spedDecimal } from "./sped.ts";
import type { Movimento } from "./types.ts";

function movimento(over: Partial<Movimento> = {}): Movimento {
  return {
    data: "2026-01-05",
    tipo: "receita_atendimento",
    categoria: "Atendimentos",
    descricao: "Atendimento — Ana",
    metodo: "PIX",
    valor_cents: 15_000,
    gorjeta_cents: 0,
    ...over,
  };
}

Deno.test("CSV: neutraliza fórmula e preserva número puro", () => {
  strictEqual(sanitizeCsvCell("=SOMA(A1)"), "'=SOMA(A1)");
  strictEqual(sanitizeCsvCell("+55"), "'+55");
  strictEqual(sanitizeCsvCell("-descricao"), "'-descricao");
  strictEqual(sanitizeCsvCell("@user"), "'@user");
  strictEqual(sanitizeCsvCell("-12,34"), "-12,34");
  strictEqual(sanitizeCsvCell("1234"), "1234");
  strictEqual(sanitizeCsvCell("texto normal"), "texto normal");
});

Deno.test("CSV: header, valores formatados e escape de aspa/ponto-e-vírgula", () => {
  const csv = buildCsv([
    movimento({ descricao: 'Cliente "; DROP', valor_cents: 123_456 }),
  ]);
  const [header, line] = csv.split("\r\n");
  strictEqual(
    header,
    "Data;Tipo;Categoria;Descricao;Metodo;Valor_centavos;Gorjeta_centavos;Valor_BRL",
  );
  strictEqual(
    line,
    '2026-01-05;receita_atendimento;Atendimentos;"Cliente ""; DROP";PIX;123456;0;1234,56',
  );
  strictEqual(csv.endsWith("\r\n"), true);
});

Deno.test("CSV: escopo fiscal vira linhas de NFC-e legíveis", () => {
  const rows = fiscalToMovimentos([
    {
      id: "f1",
      numero: "10",
      serie: "1",
      chave_acesso: null,
      status: "autorizada",
      valor_cents: 5_000,
      data: "2026-01-10",
    },
    {
      id: "f2",
      numero: null,
      serie: null,
      chave_acesso: null,
      status: "cancelada",
      valor_cents: 2_000,
      data: "2026-01-11",
    },
  ]);
  strictEqual(rows.length, 2);
  strictEqual(rows[0].categoria, "NFC-e");
  strictEqual(rows[0].descricao, "NFC-e nº 10 série 1 — Autorizada");
  strictEqual(rows[1].descricao, "NFC-e sem número — Cancelada");
  strictEqual(rows[0].valor_cents, 5_000);
});

Deno.test("OFX: datas, valores e saldo de fechamento = abertura + linhas", () => {
  strictEqual(ofxDate("2026-01-31"), "20260131");
  strictEqual(ofxAmount(-1234), "-12.34");
  const ofx = buildOfx({
    periodoIni: "2026-01-01",
    periodoFim: "2026-01-31",
    openingCents: 10_000,
    meta: { consolidado: false, banco: "Banco Teste", contaUltimos4: "1234" },
    generatedAt: new Date("2026-02-01T12:00:00.000Z"),
    lines: [
      { id: "l1", data: "2026-01-05", descricao: "Recebimento <PIX>", valor_cents: 5_000 },
      { id: "l2", data: "2026-01-06", descricao: "Tarifa & cia", valor_cents: -1_500 },
    ],
  });
  strictEqual(ofx.startsWith("OFXHEADER:100"), true);
  strictEqual(ofx.includes("<DTSTART>20260101000000</DTSTART>"), true);
  strictEqual(ofx.includes("<DTEND>20260131235959</DTEND>"), true);
  strictEqual(ofx.includes("<ACCTID>1234</ACCTID>"), true);
  strictEqual(ofx.includes("<TRNAMT>50.00</TRNAMT>"), true);
  strictEqual(ofx.includes("<TRNAMT>-15.00</TRNAMT>"), true);
  strictEqual(ofx.includes("<MEMO>Recebimento &lt;PIX&gt;</MEMO>"), true);
  strictEqual(ofx.includes("<MEMO>Tarifa &amp; cia</MEMO>"), true);
  // 100,00 + 50,00 - 15,00 = 135,00
  strictEqual(ofx.includes("<BALAMT>135.00</BALAMT>"), true);
});

Deno.test("OFX: mais de uma conta exporta consolidado", () => {
  const ofx = buildOfx({
    periodoIni: "2026-01-01",
    periodoFim: "2026-01-31",
    openingCents: 0,
    meta: { consolidado: true, banco: "Consolidado", contaUltimos4: "2 contas" },
    generatedAt: new Date("2026-02-01T12:00:00.000Z"),
    lines: [],
  });
  strictEqual(ofx.includes("<ACCTID>CONSOLIDADO</ACCTID>"), true);
  strictEqual(escapeXml('a"b'), "a&quot;b");
});

Deno.test("SPED: bloco por escopo, totais e fechamento 9999", () => {
  const categorias = agregarCategorias([
    movimento({ valor_cents: 10_000 }),
    movimento({ valor_cents: 5_000 }),
    movimento({ tipo: "receita_avulsa", categoria: "Receitas avulsas", valor_cents: 2_000 }),
  ]);
  deepStrictEqual(
    categorias.map((c) => c.categoria),
    ["Atendimentos", "Receitas avulsas"],
  );
  strictEqual(categorias[0].total_cents, 15_000);
  strictEqual(categorias[0].quantidade, 2);

  const sped = buildSped({
    periodo: "2026-01-01..2026-01-31",
    escopo: "receber",
    categorias,
    totalCents: 17_000,
    totalCount: 3,
  });
  const linhas = sped.trim().split("\r\n");
  strictEqual(linhas[0].startsWith("|0000|ATLAS AGENDA|"), true);
  strictEqual(linhas[1].startsWith("|0001|AVISO|"), true);
  strictEqual(linhas.includes("|E110|Atendimentos|150,00|2|"), true);
  strictEqual(linhas.includes("|E110|Receitas avulsas|20,00|1|"), true);
  strictEqual(linhas.includes("|E990|TOTAL|170,00|3|"), true);
  strictEqual(linhas[linhas.length - 1], `|9999|${linhas.length}|`);

  const spedPagar = buildSped({
    periodo: "2026-01-01..2026-01-31",
    escopo: "pagar",
    categorias: [{ categoria: "aluguel", total_cents: 4_000, quantidade: 1 }],
    totalCents: 4_000,
    totalCount: 1,
  });
  strictEqual(spedPagar.includes("|E120|aluguel|40,00|1|"), true);
  strictEqual(spedDecimal(123_456), "1234,56");
});

Deno.test("SPED: categoria com pipe é sanitizada; fiscal agrega por situação", () => {
  const categorias = agregarCategorias([
    movimento({ categoria: "aluguel|fraude", valor_cents: 100 }),
  ]);
  strictEqual(categorias[0].categoria, "aluguel fraude");

  const fiscal = agregarFiscal([
    { id: "1", numero: "1", serie: "1", chave_acesso: null, status: "autorizada", valor_cents: 500, data: "2026-01-02" },
    { id: "2", numero: "2", serie: "1", chave_acesso: null, status: "cancelada", valor_cents: 300, data: "2026-01-03" },
  ]);
  const resumo = Object.fromEntries(fiscal.map((c) => [c.categoria, c.total_cents]));
  deepStrictEqual(resumo, { "NFC-e autorizada": 500, "NFC-e cancelada": 300 });
});
