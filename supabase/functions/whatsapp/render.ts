// Renderização server-side de templates de mensagem (ADR-04, Fatia 1 do WhatsApp Fase 2).
//
// FONTE CANÔNICA: `src/lib/message-templates.ts` (ADR-03). Este módulo ESPELHA em Deno a mesma
// lista fechada de variáveis e a mesma tabela de fallback — a Edge Function não pode importar os
// `@/`-aliases do app. PARIDADE OBRIGATÓRIA: qualquer mudança na lista/tabela/lógica de render da
// ADR-03 DEVE ser refletida aqui (e vice-versa). A divergência vira bug detectável (preview do
// cliente ≠ texto recebido).
//
// A renderização é 100% no servidor (decisão D5 do PRD): o cliente nunca monta o corpo final; o
// servidor é a fronteira única de envio. Peça pura e determinística (RNF-T05): sem rede, sem
// estado — o único ponto não puro (formatar `{dataHora}` no fuso) é isolado em `formatDataHora`,
// que recebe o fuso explícito e usa só `Intl`.

/** Templates da régua — espelha `messages.template` / `schemas.ts#templateSchema`. */
export type TemplateKey = "confirmacao" | "lembrete_d1" | "cobranca" | "comprovante";

/**
 * Lista fechada das variáveis suportadas (sem as chaves `{}`). Espelha
 * `TEMPLATE_VARIABLES` da ADR-03. `{valor}` fica FORA da Fatia 1 (decisão D4).
 */
export const TEMPLATE_VARIABLES = [
  "nome",
  "servico",
  "dataHora",
  "empresa",
] as const;

export type TemplateVariable = (typeof TEMPLATE_VARIABLES)[number];

/**
 * Tabela de fallback pt-BR — ESPELHA `TEMPLATE_FALLBACKS` da ADR-03 (canônica do PRD §RF-T07).
 * Usada quando o dado da variável falta (ausente/`null`/vazio). `{empresa}`: o chamador passa o
 * `trade_name` (ou `null`); aplica-se `nossa equipe` quando nulo/vazio.
 */
export const TEMPLATE_FALLBACKS: Record<TemplateVariable, string> = {
  nome: "cliente",
  servico: "seu atendimento",
  dataHora: "no horário combinado",
  empresa: "nossa equipe",
};

/**
 * Texto de sistema padrão por chave — usado quando o tenant NÃO tem a linha em
 * `message_templates` (tenant legado antes da baseline, ou template inativo). ESPELHA os textos
 * do seed da ADR-02 (`20250222091000_message_templates_baseline.sql`): o cliente final NUNCA
 * recebe a chave crua nem texto vazio (RF-T07). Paridade com o seed: mudar lá obriga mudar aqui.
 */
export const DEFAULT_TEMPLATE_BODIES: Record<TemplateKey, string> = {
  confirmacao:
    "Olá {nome}! Seu horário de {servico} na {empresa} está marcado para {dataHora}.",
  lembrete_d1:
    "Oi {nome}, lembrete do seu {servico} na {empresa} em {dataHora}. Responda 1 para confirmar ou 2 para reagendar.",
  cobranca: "Olá {nome}, segue a cobrança do seu {servico} na {empresa}.",
  comprovante: "Recebemos o pagamento do seu {servico} na {empresa}. Obrigado, {nome}!",
};

/** Valores das variáveis resolvidas para a renderização. */
export type TemplateVars = Partial<Record<TemplateVariable, string | null>>;

/** Conjunto das variáveis conhecidas, para checagem O(1) na substituição. */
const KNOWN_VARIABLES = new Set<string>(TEMPLATE_VARIABLES);

/** Casa qualquer `{token}` com nome de variável simples (`{nome}`, `{foo}`). */
const TOKEN_PATTERN = /\{([a-zA-Z][a-zA-Z0-9_]*)\}/g;

/**
 * Renderiza o corpo de um template substituindo as variáveis conhecidas. ESPELHA
 * `renderTemplate` da ADR-03 — mesmo comportamento:
 *  - variável conhecida com valor presente e não vazio → o valor fornecido;
 *  - variável conhecida sem dado (ausente/`null`/vazio) → o fallback pt-BR;
 *  - token desconhecido (`{foo}`) → mantido literal.
 *
 * Função pura: não lança; nunca devolve uma variável conhecida crua.
 */
export function renderTemplate(body: string, vars: TemplateVars): string {
  return body.replace(TOKEN_PATTERN, (match, rawName: string) => {
    if (!KNOWN_VARIABLES.has(rawName)) {
      return match;
    }
    const variable = rawName as TemplateVariable;
    const value = vars[variable];
    if (value != null && value.trim() !== "") {
      return value;
    }
    return TEMPLATE_FALLBACKS[variable];
  });
}

/**
 * Formata o instante UTC de `starts_at` para `{dataHora}` no fuso do tenant, em pt-BR. Mínimo
 * necessário (o servidor não importa `src/lib/datetime.ts`): usa só `Intl.DateTimeFormat`
 * (`dd/MM/yyyy HH:mm`). Retorna `null` quando o instante é inválido/ausente — o chamador deixa o
 * fallback de `{dataHora}` cobrir. Pura dado (iso, timeZone).
 */
export function formatDataHora(
  startsAtIso: string | null | undefined,
  timeZone: string,
): string | null {
  if (!startsAtIso) return null;
  const date = new Date(startsAtIso);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("pt-BR", {
    timeZone,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const get = (type: string): string =>
    parts.find((p) => p.type === type)?.value ?? "";
  const day = get("day");
  const month = get("month");
  const year = get("year");
  const hour = get("hour");
  const minute = get("minute");
  if (!day || !month || !year || !hour || !minute) return null;
  return `${day}/${month}/${year} ${hour}:${minute}`;
}
