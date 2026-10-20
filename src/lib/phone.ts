/**
 * Utilitários de telefone. O banco guarda o número em **E.164** (ex.:
 * `+5511999998888`); a UI exibe uma forma legível br só na borda de
 * apresentação. A normalização de entrada para E.164 (`toE164BR`) é consumida
 * pelo `customerSchema` (validações zod) no submit do cadastro/edição.
 */

/**
 * Normaliza um telefone digitado (forma br livre) para **E.164-BR canônico**
 * (`+55` + DDD + assinante). Helper puro e determinístico: sem rede, sem
 * relógio, sem segredo.
 *
 * Espelha a **especificação canônica da ADR-01** (dona da regra; a borda do
 * servidor em `supabase/functions/whatsapp/evolution-adapter.ts`
 * `normalizePhoneForEvolution`/`applyBrDdi` aplica a MESMA tabela — não devem
 * divergir, RF-E164-05). Após `replace(/\D+/g, "")`:
 *
 *  | Entrada (dígitos após limpar)                  | Regra         | Saída          |
 *  |------------------------------------------------|---------------|----------------|
 *  | 10 díg, fixo com DDD (nacional sem DDI)        | prefixa `55`  | `+55` + díg    |
 *  | 11 díg, móvel com DDD (nacional sem DDI)       | prefixa `55`  | `+55` + díg    |
 *  | 12 díg começando com `55` (fixo BR com DDI)    | mantém        | `+` + díg      |
 *  | 13 díg começando com `55` (móvel BR com DDI)   | mantém        | `+` + díg      |
 *  | < 10 díg (curto demais) ou > 13 díg (inválido) | rejeita       | `null`         |
 *
 * A fronteira é o **comprimento** (10/11 = nacional sem DDI; 12/13 = já com
 * DDI), não só o prefixo: um número de 11 díg começando com `55` é DDD 55
 * (Rio Grande do Sul) + 9 díg móveis = nacional sem DDI → prefixa (`+5555...`).
 *
 * **Diferença da borda do servidor (ADR-01):** aqui o comprimento inválido é
 * **rejeitado** devolvendo `null` (o `customerSchema` recusa o submit com erro
 * pt-BR — RF-E164-03); na borda, inválido é defesa que não lança (a Evolution
 * recusa). A regra de reconhecimento/DDI é idêntica.
 *
 * @returns E.164-BR com `+` (ex.: `+5547992391751`), ou `null` se inválido.
 */
export function toE164BR(input: string): string | null {
  const digits = input.replace(/\D+/g, "");
  const len = digits.length;

  // 10/11 díg = nacional sem DDI (fronteira por COMPRIMENTO): prefixa `55`,
  // inclusive quando começa com `55` (DDD 55 — RS: 11 díg = DDD 55 + 9 móveis).
  if (len === 10 || len === 11) {
    return `+55${digits}`;
  }
  // 12/13 díg começando com `55` = já com DDI (idempotente): mantém.
  if ((len === 12 || len === 13) && digits.startsWith("55")) {
    return `+${digits}`;
  }
  // Comprimento inválido (curto demais / longo demais / 12-13 díg sem `55`):
  // rejeita — sinaliza inválido para o schema recusar o submit.
  return null;
}

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
