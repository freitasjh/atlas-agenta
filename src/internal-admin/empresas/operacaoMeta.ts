/**
 * Formatação compartilhada da aba Operação do back-office (ADR-11).
 *
 * Instantes vêm em UTC (timestamptz) e são exibidos no fuso do navegador em
 * pt-BR — mesma borda de apresentação usada nas demais telas internas. Valor
 * ausente/ inválido vira "—" (nunca "null"/vazio).
 */
export function formatarDateTimeOperacao(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(date);
}
