/**
 * Utilitários de comissão por profissional (ADR-05, Fase 1b). Espelha o padrão
 * de `src/lib/money.ts`: a conversão fica confinada aqui e **nunca** trafega
 * float como fonte de verdade na borda.
 *
 * Transporte do percentual (PRD D-11, fechado na ADR-01): o banco guarda
 * `numeric(5,2)` (0,00–100,00). Na borda do cliente, a fonte de verdade do form
 * é um **inteiro em base points (bps)**: `0`–`10000` = `0,00%`–`100,00%`
 * (1 bps = 0,01%). Inteiro é determinístico; evita erro de ponto flutuante na
 * entrada/saída. A UI converte bps↔percent para exibir/ler; o acesso ao banco
 * converte bps↔numeric. O valor da comissão em dinheiro é apurado no servidor
 * (trigger) e só exibido via `formatCentsToBRL`.
 */

/** Limite inferior de bps (0,00%). */
export const MIN_COMMISSION_BPS = 0;
/** Limite superior de bps (100,00%). */
export const MAX_COMMISSION_BPS = 10000;

const PERCENT_FORMATTER = new Intl.NumberFormat("pt-BR", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

/**
 * Formata bps como percentual pt-BR para exibição/pré-preenchimento (sem o
 * sufixo "%", que fica a cargo da UI). Ex.: `4000` → "40"; `1250` → "12,5";
 * `3333` → "33,33". Entrada não-finita cai em "0".
 */
export function formatBpsToPercent(bps: number): string {
  const safe = Number.isFinite(bps) ? bps : 0;
  return PERCENT_FORMATTER.format(safe / 100);
}

/**
 * Converte uma string de percentual digitada (pt-BR ou com ponto decimal) para
 * bps inteiro. Aceita "40", "12,5", "33,33", "40%". Retorna `null` quando a
 * entrada não representa um número ou fica fora de 0–100.
 *
 * O arredondamento para inteiro é half-up determinístico (`Math.round`), de modo
 * que no máximo 2 casas decimais de percentual sobrevivem (1 bps = 0,01%).
 */
export function parsePercentToBps(input: string): number | null {
  const trimmed = input.trim();
  if (trimmed === "") return null;

  // Remove tudo que não é dígito, vírgula, ponto ou sinal.
  let normalized = trimmed.replace(/[^\d,.-]/g, "");
  // Sem nenhum dígito, a entrada não é número ("abc" → "" → Number("") === 0).
  if (!/\d/.test(normalized)) return null;
  if (normalized.includes(",")) {
    // pt-BR: ponto é separador de milhar, vírgula é decimal.
    normalized = normalized.replace(/\./g, "").replace(",", ".");
  }

  const percent = Number(normalized);
  if (!Number.isFinite(percent)) return null;

  const bps = Math.round(percent * 100);
  if (bps < MIN_COMMISSION_BPS || bps > MAX_COMMISSION_BPS) return null;

  return bps;
}

/**
 * Converte bps inteiro para o `numeric(5,2)` que o banco persiste (ex.: `4000`
 * → `40`, `3333` → `33.33`). Devolve um `number` com no máximo 2 casas, pronto
 * para o transporte ao PostgREST. Entrada não-finita vira `0`.
 */
export function bpsToNumericPct(bps: number): number {
  const safe = Number.isFinite(bps) ? bps : 0;
  // bps é inteiro; dividir por 100 produz no máximo 2 casas decimais exatas.
  return safe / 100;
}

/**
 * Converte o `numeric(5,2)` lido do banco para bps inteiro (ex.: `40` → `4000`,
 * `33.33` → `3333`). `Math.round` protege contra ruído de ponto flutuante na
 * desserialização. Entrada não-finita vira `0`.
 */
export function numericPctToBps(pct: number): number {
  const safe = Number.isFinite(pct) ? pct : 0;
  return Math.round(safe * 100);
}
