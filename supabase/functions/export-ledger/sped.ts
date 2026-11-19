// SPED-resumo (gerencial) do export contábil (ADR-10).
//
// ESTE ARQUIVO NÃO É SPED FISCAL VÁLIDO. É um resumo gerencial em blocos
// inspirados no leiaute EFD (E1xx) para o contador conferir totais por
// categoria no período. O primeiro registro declara isso explicitamente e a UI
// chama o formato de "SPED-resumo (gerencial)" — nunca "SPED".
//
// Totais por categoria saem da MESMA base do DRE (caixa): receitas = ledger +
// avulsas recebidas; despesas = baixas de payables. É por isso que a soma do
// bloco bate com `dre_report(..., 'caixa')`.

import type { Escopo, FiscalDoc, Movimento } from "./types.ts";

export interface SpedCategoria {
  categoria: string;
  total_cents: number;
  quantidade: number;
}

export interface SpedInput {
  /** `YYYY-MM-DD..YYYY-MM-DD`. */
  periodo: string;
  escopo: Escopo;
  categorias: readonly SpedCategoria[];
  totalCents: number;
  totalCount: number;
}

const BLOCO_POR_ESCOPO: Record<Escopo, string> = {
  receber: "E110",
  pagar: "E120",
  fiscal: "E130",
};

/** Remove o delimitador e quebras do campo (SPED usa `|` como separador). */
export function spedText(value: string): string {
  return value.replace(/[|\r\n]+/g, " ").trim().slice(0, 200);
}

/** Centavos → decimal com vírgula, sem separador de milhar (`1234,56`). */
export function spedDecimal(cents: number): string {
  return (cents / 100).toFixed(2).replace(".", ",");
}

export function agregarCategorias(movimentos: readonly Movimento[]): SpedCategoria[] {
  const acumulado = new Map<string, SpedCategoria>();
  for (const movimento of movimentos) {
    const categoria = spedText(movimento.categoria) || "Sem categoria";
    const atual = acumulado.get(categoria) ?? { categoria, total_cents: 0, quantidade: 0 };
    atual.total_cents += movimento.valor_cents;
    atual.quantidade += 1;
    acumulado.set(categoria, atual);
  }
  return [...acumulado.values()].sort((a, b) => a.categoria.localeCompare(b.categoria));
}

/** Agrega documentos fiscais por situação (escopo `fiscal`). */
export function agregarFiscal(docs: readonly FiscalDoc[]): SpedCategoria[] {
  const rotulos: Record<string, string> = {
    autorizada: "NFC-e autorizada",
    contingencia: "NFC-e contingência",
    cancelada: "NFC-e cancelada",
  };
  return agregarCategorias(
    docs.map((doc) => ({
      data: doc.data,
      tipo: "fiscal",
      categoria: rotulos[doc.status] ?? "NFC-e",
      descricao: "",
      metodo: "",
      valor_cents: doc.valor_cents,
      gorjeta_cents: 0,
    })),
  );
}

export function buildSped(input: SpedInput): string {
  const bloco = BLOCO_POR_ESCOPO[input.escopo];
  const registros = [
    `|0000|ATLAS AGENDA|EXPORTACAO CONTABIL GERENCIAL|${spedText(input.periodo)}|${input.escopo}|`,
    "|0001|AVISO|Arquivo gerencial de conferencia: nao substitui o SPED fiscal oficial|",
    `|E100|${spedText(input.periodo)}|${input.escopo}|`,
    ...input.categorias.map(
      (categoria) =>
        `|${bloco}|${categoria.categoria}|${spedDecimal(categoria.total_cents)}|${categoria.quantidade}|`,
    ),
    `|E990|TOTAL|${spedDecimal(input.totalCents)}|${input.totalCount}|`,
  ];
  // 9999 fecha o arquivo e conta a si mesmo.
  registros.push(`|9999|${registros.length + 1}|`);
  return registros.join("\r\n") + "\r\n";
}
