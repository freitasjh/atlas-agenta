/**
 * Utilitários de dinheiro. Toda a app trafega e armazena valores em
 * **centavos inteiros** (`*_cents`); reais só aparecem na borda de
 * apresentação/entrada. Nunca usar float para persistir dinheiro.
 */

const BRL_FORMATTER = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

/** Formata centavos inteiros como moeda pt-BR (ex.: `4500` → "R$ 45,00"). */
export function formatCentsToBRL(cents: number): string {
  return BRL_FORMATTER.format((Number.isFinite(cents) ? cents : 0) / 100);
}

/**
 * Converte uma string digitada em reais para centavos inteiros.
 * Aceita a forma pt-BR ("45,00", "R$ 1.234,56") e a forma com ponto decimal
 * ("45.00"). Retorna `null` quando a entrada não representa um número.
 */
export function parseBRLToCents(input: string): number | null {
  const trimmed = input.trim();
  if (trimmed === "") return null;

  // Remove tudo que não é dígito, vírgula, ponto ou sinal.
  let normalized = trimmed.replace(/[^\d,.-]/g, "");
  const hasComma = normalized.includes(",");

  if (hasComma) {
    // pt-BR: ponto é separador de milhar, vírgula é decimal.
    normalized = normalized.replace(/\./g, "").replace(",", ".");
  }
  // Sem vírgula, o ponto (se houver) é tratado como decimal.

  const reais = Number(normalized);
  if (!Number.isFinite(reais)) return null;

  return Math.round(reais * 100);
}
