/**
 * Contrato de renderização de templates de mensagem (ADR-03, Fatia 1 do
 * WhatsApp Fase 2) — **fonte canônica compartilhada** entre o preview do editor
 * (cliente, ADR-06) e a renderização de envio (servidor, ADR-04). O servidor
 * **replica** esta mesma lista fechada e tabela de fallback em Deno (não pode
 * importar `@/`-aliases do app); qualquer mudança aqui obriga atualizar lá.
 *
 * Peça pura e determinística (RNF-T05): mesma entrada → mesma saída, sem rede,
 * relógio ou estado. A decisão D4 do PRD trava a lista fechada
 * `{nome} {servico} {dataHora} {empresa}` nos três pontos de uso (chip-bar do
 * editor, preview, render do servidor). `{valor}` é evolução aditiva futura —
 * **não** incluir nesta fatia.
 */

/**
 * Lista fechada das variáveis suportadas (sem as chaves `{}`). Única fonte das
 * variáveis conhecidas; serve de base para os chips do editor e para a tabela
 * de fallback. Ordem = ordem de exibição dos chips.
 */
export const TEMPLATE_VARIABLES = [
  "nome",
  "servico",
  "dataHora",
  "empresa",
] as const;

export type TemplateVariable = (typeof TEMPLATE_VARIABLES)[number];

/**
 * Metadados dos chips de variável do editor (ADR-06 consome). `token` é o texto
 * inserido no cursor; `label` é o rótulo pt-BR do chip.
 */
export const TEMPLATE_VARIABLE_META: ReadonlyArray<{
  variable: TemplateVariable;
  token: `{${TemplateVariable}}`;
  label: string;
}> = [
  { variable: "nome", token: "{nome}", label: "Nome do cliente" },
  { variable: "servico", token: "{servico}", label: "Serviço" },
  { variable: "dataHora", token: "{dataHora}", label: "Data e hora" },
  { variable: "empresa", token: "{empresa}", label: "Empresa" },
];

/**
 * Tabela de fallback pt-BR (canônica do PRD §RF-T07). Usada quando o dado da
 * variável falta (ausente/`null`/vazio). `{empresa}`: o chamador passa o
 * `trade_name` do tenant (ou `null`); a função aplica `nossa equipe` quando
 * nulo/vazio.
 */
export const TEMPLATE_FALLBACKS: Record<TemplateVariable, string> = {
  nome: "cliente",
  servico: "seu atendimento",
  dataHora: "no horário combinado",
  empresa: "nossa equipe",
};

/** Valores das variáveis resolvidas para a renderização. */
export type TemplateVars = Partial<Record<TemplateVariable, string | null>>;

/** Conjunto das variáveis conhecidas, para checagem O(1) na substituição. */
const KNOWN_VARIABLES = new Set<string>(TEMPLATE_VARIABLES);

/** Casa qualquer `{token}` com nome de variável simples (`{nome}`, `{foo}`). */
const TOKEN_PATTERN = /\{([a-zA-Z][a-zA-Z0-9_]*)\}/g;

/**
 * Resolve uma variável conhecida: o valor fornecido quando presente e não vazio,
 * senão o fallback pt-BR da tabela. Fonte única do critério de resolução,
 * compartilhada por `renderTemplate` (texto plano) e `segmentTemplate` (realce).
 */
function resolveVariable(variable: TemplateVariable, vars: TemplateVars): string {
  const value = vars[variable];
  if (value != null && value.trim() !== "") {
    return value;
  }
  return TEMPLATE_FALLBACKS[variable];
}

/**
 * Renderiza o corpo de um template substituindo as variáveis conhecidas.
 *
 * - Variável conhecida com valor presente e não vazio → o valor fornecido.
 * - Variável conhecida sem dado (ausente/`null`/vazio) → o fallback pt-BR da
 *   tabela (`TEMPLATE_FALLBACKS`); nunca o placeholder cru.
 * - Token **desconhecido** (ex.: `{foo}`) → mantido **literal** no texto
 *   (decisão consciente do PRD §RF-T07 — só as variáveis conhecidas têm
 *   fallback; nunca exibir erro ao cliente).
 *
 * Função pura: não lança e nunca devolve uma variável conhecida crua.
 */
export function renderTemplate(body: string, vars: TemplateVars): string {
  return body.replace(TOKEN_PATTERN, (match, rawName: string) => {
    if (!KNOWN_VARIABLES.has(rawName)) {
      // Token desconhecido: mantém literal.
      return match;
    }
    return resolveVariable(rawName as TemplateVariable, vars);
  });
}

/**
 * Segmento de um template renderizado para fins de **realce visual** no preview:
 * `text` é texto literal (inclui tokens desconhecidos, mantidos crus), `var` é o
 * valor resolvido de uma variável conhecida (destacado por fundo na UI).
 */
export type TemplateSegment =
  | { kind: "text"; value: string }
  | { kind: "var"; value: string };

/**
 * Versão de `renderTemplate` que **preserva quais trechos foram substituídos**,
 * para o preview realçar as variáveis por fundo (texto em `foreground`). Aplica
 * exatamente a mesma lista fechada e a mesma tabela de fallback de
 * `renderTemplate` — concatenar os `value` dos segmentos reproduz, caractere a
 * caractere, a saída de `renderTemplate(body, vars)`. Peça pura compartilhada
 * entre o editor (ADR-06) e o `SendMessageDialog` (ADR-07) — fonte única da
 * semântica de segmentação, para não divergir do contrato canônico.
 */
export function segmentTemplate(
  body: string,
  vars: TemplateVars,
): TemplateSegment[] {
  const segments: TemplateSegment[] = [];
  let lastIndex = 0;
  for (const match of body.matchAll(TOKEN_PATTERN)) {
    const [raw, name] = match;
    const start = match.index ?? 0;
    if (!KNOWN_VARIABLES.has(name)) {
      // Token desconhecido: mantém literal (parte do texto comum).
      continue;
    }
    if (start > lastIndex) {
      segments.push({ kind: "text", value: body.slice(lastIndex, start) });
    }
    segments.push({
      kind: "var",
      value: resolveVariable(name as TemplateVariable, vars),
    });
    lastIndex = start + raw.length;
  }
  if (lastIndex < body.length) {
    segments.push({ kind: "text", value: body.slice(lastIndex) });
  }
  return segments;
}

/**
 * Resolve o valor da variável `{empresa}` com o MESMO encadeamento do servidor
 * (`resolveRenderedText` em `supabase/functions/whatsapp/index.ts`):
 * `trade_name` → `legal_name` → `null` (cada um trimado; vazio conta como
 * ausente). Garante que o preview do cliente e o texto enviado coincidam para
 * tenants com nome fantasia vazio e razão social preenchida. `null` cai no
 * fallback `nossa equipe` na renderização.
 */
export function resolveEmpresa(
  tradeName: string | null | undefined,
  legalName: string | null | undefined,
): string | null {
  return tradeName?.trim() || legalName?.trim() || null;
}
