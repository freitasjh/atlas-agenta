/**
 * Utilitários de telefone. O banco guarda o número em **E.164** (ex.:
 * `+5511999998888`); a UI exibe uma forma legível br só na borda de
 * apresentação. A normalização de entrada para E.164 fica no `customerSchema`
 * (validações zod), não aqui.
 */

/**
 * Formata um telefone E.164 para leitura em pt-BR. Reconhece números
 * brasileiros (`+55` com DDD + 8 ou 9 dígitos) e os exibe como
 * `+55 (11) 99999-8888`. Para outros países ou formatos inesperados, devolve o
 * valor original sem quebrar.
 */
export function formatPhoneForDisplay(phone: string): string {
  const digits = phone.replace(/\D/g, "");

  // Brasil: 55 + DDD (2) + assinante (8 ou 9).
  if (digits.startsWith("55") && (digits.length === 12 || digits.length === 13)) {
    const ddd = digits.slice(2, 4);
    const subscriber = digits.slice(4);
    const breakpoint = subscriber.length === 9 ? 5 : 4;
    const prefix = subscriber.slice(0, breakpoint);
    const suffix = subscriber.slice(breakpoint);
    return `+55 (${ddd}) ${prefix}-${suffix}`;
  }

  return phone;
}
