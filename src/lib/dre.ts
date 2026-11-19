import { z } from "zod";

import { buildCsv, type CsvColumn } from "@/lib/retention-csv";

/**
 * DRE + fluxo de caixa (Fase 5 ADR-09). Tipos, validação (zod) e helpers puros
 * da tela `/app/financeiro/dre`. Dinheiro em `*_cents` inteiro; a RPC devolve
 * números já agregados — a UI nunca re-soma fonte nem inventa categoria.
 *
 * Fronteiras de negócio (ADR-09): receita de atendimento = ledger (SSoT);
 * avulsas ficam em grupo próprio; recorrência (membership) tem grupo próprio;
 * gorjeta NUNCA entra em receita/margem/resultado (só é informada à parte para
 * auditoria). O regime muda a data do reconhecimento, nunca a fonte.
 */

export const DRE_REGIMES = ["competencia", "caixa"] as const;
export type DreRegime = (typeof DRE_REGIMES)[number];

export const DRE_REGIME_META: Record<DreRegime, { rotulo: string; descricao: string }> = {
  competencia: {
    rotulo: "Competência",
    descricao: "Receita e custo pela data do atendimento; despesa pelo vencimento quitado.",
  },
  caixa: {
    rotulo: "Caixa",
    descricao: "Entradas pelo recebimento e saídas pela baixa efetiva.",
  },
};

const grupoSchema = z.object({
  categoria: z.string(),
  valor_cents: z.number().int(),
});

export const dreMesSchema = z.object({
  /** `YYYY-MM` do mês no fuso do tenant. */
  mes: z.string().regex(/^\d{4}-\d{2}$/),
  receitas_cents: z.number().int(),
  custos_cents: z.number().int(),
  despesas_cents: z.number().int(),
  resultado_cents: z.number().int(),
});
export type DreMes = z.infer<typeof dreMesSchema>;

export const dreReportSchema = z.object({
  regime: z.enum(DRE_REGIMES),
  ini: z.string(),
  fim: z.string(),
  receitas: z.object({ total_cents: z.number().int(), grupos: z.array(grupoSchema) }),
  custos: z.object({ total_cents: z.number().int(), grupos: z.array(grupoSchema) }),
  margem_cents: z.number().int(),
  despesas: z.object({ total_cents: z.number().int(), grupos: z.array(grupoSchema) }),
  resultado_cents: z.number().int(),
  /** Gorjeta recebida no período — informativa, fora de todos os totais. */
  gorjeta_ignorada_cents: z.number().int().default(0),
  /** Série mensal contínua do período (meses sem movimento vêm zerados). */
  meses: z.array(dreMesSchema),
});
export type DreReport = z.infer<typeof dreReportSchema>;
export type DreGrupo = z.infer<typeof grupoSchema>;

export const cashflowDiaSchema = z.object({
  /** `YYYY-MM-DD` no fuso do tenant. */
  dia: z.string(),
  entradas_cents: z.number().int(),
  saidas_cents: z.number().int(),
  saldo_dia_cents: z.number().int(),
  saldo_acumulado_cents: z.number().int(),
});
export type CashflowDia = z.infer<typeof cashflowDiaSchema>;

export const cashflowSchema = z.object({
  base: z.string(),
  dias: z.array(cashflowDiaSchema),
  total_entradas_cents: z.number().int(),
  total_saidas_cents: z.number().int(),
  saldo_final_cents: z.number().int(),
});
export type Cashflow = z.infer<typeof cashflowSchema>;

export const exportLogSchema = z.object({
  id: z.string(),
  tipo: z.string(),
  periodo: z.string(),
  formato: z.string(),
  arquivo_path: z.string().nullable(),
  created_at: z.string(),
});
export type ExportLog = z.infer<typeof exportLogSchema>;

/** Ordem fixa dos blocos do DRE (Receitas − Custos = Margem − Despesas = Resultado). */
export const DRE_SECOES = ["receitas", "custos", "margem", "despesas", "resultado"] as const;

/** Mensagem pt-BR para o código estável devolvido pela RPC. */
export function dreErrorMessage(codigo: string | null | undefined, fallback: string): string {
  if (!codigo) return fallback;
  if (codigo.includes("FEATURE_DISABLED")) {
    return "O DRE não está incluído no plano atual.";
  }
  if (codigo.includes("FORBIDDEN")) {
    return "Apenas o administrador da empresa pode ver o DRE.";
  }
  if (codigo.includes("RANGE_TOO_LARGE")) {
    return "Período longo demais para o DRE. Escolha até 12 meses.";
  }
  if (codigo.includes("INVALID_REGIME")) {
    return "Regime inválido. Escolha competência ou caixa.";
  }
  if (codigo.includes("INVALID_BODY")) {
    return "Período inválido. Confira as datas de início e fim.";
  }
  return fallback;
}

const MESES_CURTOS = [
  "jan",
  "fev",
  "mar",
  "abr",
  "mai",
  "jun",
  "jul",
  "ago",
  "set",
  "out",
  "nov",
  "dez",
] as const;

/** `2026-01` → `jan/2026` (pt-BR, sem depender de `Intl` de data). */
export function mesLabel(mes: string): string {
  const [ano, numero] = mes.split("-");
  const indice = Number(numero) - 1;
  if (!Number.isFinite(indice) || indice < 0 || indice > 11) return mes;
  return `${MESES_CURTOS[indice]}/${ano}`;
}

/** `2026-01-05` → `05/01` (dia/mês do eixo do fluxo). */
export function diaLabel(dia: string): string {
  const [, mes, numero] = dia.split("-");
  if (!mes || !numero) return dia;
  return `${numero}/${mes}`;
}

/** Últimos `limite` meses da série (a série vem crescente da RPC). */
export function ultimosMeses(meses: readonly DreMes[], limite = 6): DreMes[] {
  if (limite <= 0) return [];
  return meses.slice(-limite);
}

export interface MesAcumulado {
  mes: DreMes;
  /** Resultado acumulado dos meses exibidos (linha do gráfico). */
  acumulado_cents: number;
}

/** Série mensal com o resultado acumulado (a linha do gráfico de 6 meses). */
export function comAcumulado(meses: readonly DreMes[]): MesAcumulado[] {
  let acumulado = 0;
  return meses.map((mes) => {
    acumulado += mes.resultado_cents;
    return { mes, acumulado_cents: acumulado };
  });
}

/** A série mensal existe e cobre todos os meses do período? */
export function semMovimento(report: DreReport): boolean {
  return (
    report.receitas.total_cents === 0 &&
    report.custos.total_cents === 0 &&
    report.despesas.total_cents === 0
  );
}

export interface DreCsvRow {
  regime: string;
  periodo: string;
  secao: string;
  categoria: string;
  valor: string;
}

/** Centavos → decimal com vírgula (Excel pt-BR), sem símbolo de moeda. */
export function centavosParaCsv(cents: number): string {
  const valor = (Number.isFinite(cents) ? cents : 0) / 100;
  return valor.toFixed(2).replace(".", ",");
}

/**
 * Linhas do CSV do DRE: blocos na mesma ordem da tela, com o total de cada
 * bloco e as categorias (avulsas e recorrência sempre nomeadas).
 *
 * Gorjeta NÃO vira linha nem observação: o arquivo é o DRE (receita de
 * serviço), e um valor fora de todos os totais no meio das seções convidaria a
 * somar errado. A transparência da gorjeta fica na tela (`gorjeta_ignorada_cents`).
 */
export function dreCsvRows(report: DreReport, periodo: string): DreCsvRow[] {
  const linha = (secao: string, categoria: string, cents: number): DreCsvRow => ({
    regime: DRE_REGIME_META[report.regime].rotulo,
    periodo,
    secao,
    categoria,
    valor: centavosParaCsv(cents),
  });

  const rows: DreCsvRow[] = [linha("Receitas", "Total", report.receitas.total_cents)];
  for (const grupo of report.receitas.grupos) {
    rows.push(linha("Receitas", grupo.categoria, grupo.valor_cents));
  }
  rows.push(linha("Custos", "Total", report.custos.total_cents));
  for (const grupo of report.custos.grupos) {
    rows.push(linha("Custos", grupo.categoria, grupo.valor_cents));
  }
  rows.push(linha("Margem", "Receitas − Custos", report.margem_cents));
  rows.push(linha("Despesas", "Total", report.despesas.total_cents));
  for (const grupo of report.despesas.grupos) {
    rows.push(linha("Despesas", grupo.categoria, grupo.valor_cents));
  }
  rows.push(linha("Resultado", "Margem − Despesas", report.resultado_cents));
  return rows;
}

const DRE_CSV_COLUMNS: CsvColumn<DreCsvRow>[] = [
  { header: "Regime", value: (row) => row.regime },
  { header: "Período", value: (row) => row.periodo },
  { header: "Seção", value: (row) => row.secao },
  { header: "Categoria", value: (row) => row.categoria },
  { header: "Valor (R$)", value: (row) => row.valor },
];

/** CSV do DRE (separador `;`, UTF-8 com BOM no download). */
export function buildDreCsv(report: DreReport, periodo: string): string {
  return buildCsv(dreCsvRows(report, periodo), DRE_CSV_COLUMNS);
}

/** Nome estável do arquivo: `dre-{regime}-{ini}_{fim}.csv`. */
export function dreCsvFileName(regime: DreRegime, ini: string, fim: string): string {
  const apenasData = (valor: string) => valor.slice(0, 10);
  return `dre-${regime}-${apenasData(ini)}_${apenasData(fim)}.csv`;
}
