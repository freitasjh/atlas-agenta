/**
 * Formatação pt-BR dos números do painel. Taxas vêm da RPC como fração
 * `0..1` (ou `null` quando o denominador é 0, D5) e são exibidas em % com uma
 * casa; contagens são inteiros. Centralizado para hero, KpiCards e DeltaBadge
 * falarem a mesma língua.
 */

const PERCENT_FORMATTER = new Intl.NumberFormat("pt-BR", {
  style: "percent",
  minimumFractionDigits: 0,
  maximumFractionDigits: 1,
});

const INTEGER_FORMATTER = new Intl.NumberFormat("pt-BR", {
  maximumFractionDigits: 0,
});

const ONE_DECIMAL_FORMATTER = new Intl.NumberFormat("pt-BR", {
  maximumFractionDigits: 1,
});

/** Placeholder honesto para taxa sem denominador (nunca "0%"/"NaN"). */
export const RATE_EMPTY = "—";

/** Fração `0..1` → "12,5%". `null` → "—". */
export function formatRate(rate: number | null): string {
  if (rate === null) return RATE_EMPTY;
  return PERCENT_FORMATTER.format(rate);
}

/** Inteiro com separador de milhar pt-BR. */
export function formatCount(value: number): string {
  return INTEGER_FORMATTER.format(value);
}

/**
 * Magnitude de variação entre duas taxas (frações `0..1`), em pontos
 * percentuais: ex. 0,15 → 0,10 = "5 p.p.". Recebe o delta absoluto em fração.
 */
export function formatRateDelta(deltaFraction: number): string {
  const pp = deltaFraction * 100;
  return `${ONE_DECIMAL_FORMATTER.format(pp)} p.p.`;
}

/** Magnitude de variação entre duas contagens (inteiros). */
export function formatCountDelta(delta: number): string {
  return formatCount(delta);
}
