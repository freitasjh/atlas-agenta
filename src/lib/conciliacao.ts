import { z } from "zod";

/**
 * Conciliação bancária (Fase 5 ADR-08). Tipos + metas + helpers puros da UI
 * (`/app/financeiro/conciliacao`). Dinheiro em `*_cents` (valor ASSINADO na linha
 * do extrato: crédito > 0, débito < 0); tempo em timestamptz UTC.
 *
 * Regras do ADR que vivem aqui (e são testadas em `conciliacao.test.ts`):
 *  - match = valor EXATO + |Δdata| ≤ 2 dias (`RECONCILIACAO_TOLERANCIA_DIAS`);
 *  - undo é oferecido só nos 5s seguintes ao vínculo (`UNDO_WINDOW_MS`);
 *    depois disso o desfazer exige motivo e é auditado;
 *  - ignorar exige motivo legível (o banco também barra).
 */

export const CONCILIACAO_STATUSES = ["pendente", "conciliado", "ignorado"] as const;
export type ConciliacaoStatus = (typeof CONCILIACAO_STATUSES)[number];

export function isConciliacaoStatus(raw: unknown): raw is ConciliacaoStatus {
  return typeof raw === "string" && (CONCILIACAO_STATUSES as readonly string[]).includes(raw);
}

export const CONCILIACAO_STATUS_META: Record<
  ConciliacaoStatus,
  { rotulo: string; variant: "default" | "secondary" | "destructive" | "outline" }
> = {
  pendente: { rotulo: "Pendente", variant: "secondary" },
  conciliado: { rotulo: "Conciliado", variant: "default" },
  ignorado: { rotulo: "Ignorado", variant: "outline" },
};

export const RECONCILIACAO_TOLERANCIA_DIAS = 2;
export const UNDO_WINDOW_MS = 5_000;
export const CONCILIACAO_FORMATOS = ["ofx", "csv"] as const;
export type ConciliacaoFormato = (typeof CONCILIACAO_FORMATOS)[number];

export interface BankAccount {
  id: string;
  tenant_id: string;
  nome: string;
  banco: string;
  /** LGPD: só os 4 últimos dígitos; agência/conta completa nunca é persistida. */
  conta_ultimos4: string;
  saldo_inicial_cents: number;
  ativo: boolean;
  created_at: string;
}

export interface BankStatement {
  id: string;
  tenant_id: string;
  account_id: string;
  formato: ConciliacaoFormato;
  nome_arquivo: string;
  periodo_ini: string;
  periodo_fim: string;
  saldo_ini_cents: number | null;
  saldo_fim_cents: number | null;
  linhas_total: number;
  created_at: string;
}

export interface BankLine {
  id: string;
  tenant_id: string;
  statement_id: string;
  /** `yyyy-mm-dd` (UTC). */
  data: string;
  descricao: string;
  /** Assinado: crédito > 0, débito < 0. */
  valor_cents: number;
  status: ConciliacaoStatus;
  motivo_ignorado: string | null;
  created_at: string;
}

export type ReconciliationTarget = "payable" | "receivable" | "manual";

export interface ReconciliationLink {
  id: string;
  tenant_id: string;
  bank_line_id: string;
  alvo_tipo: ReconciliationTarget;
  alvo_id: string | null;
  /** Motivo legível do vínculo `manual` (obrigatório no banco). */
  motivo: string | null;
  origem: "match" | "entry";
  created_by: string | null;
  created_at: string;
}

export interface MatchCandidate {
  alvo_tipo: Exclude<ReconciliationTarget, "manual">;
  alvo_id: string;
  descricao: string;
  valor_cents: number;
  /** `yyyy-mm-dd` do vencimento do lançamento. */
  data: string;
  delta_dias: number;
  score: number;
}

export interface MatchSuggestion {
  bank_line_id: string;
  valor_cents: number;
  data: string;
  tolerancia_dias: number;
  candidatos: MatchCandidate[];
}

export const RECONCILIACAO_ALVO_META: Record<ReconciliationTarget, string> = {
  payable: "Conta a pagar",
  receivable: "Conta a receber",
  manual: "Manual",
};

/** Extrato com valor assinado formatado para leitura (`+R$ 10,00` / `−R$ 10,00`). */
export function valorAssinado(cents: number): string {
  const valor = Number.isFinite(cents) ? Math.abs(cents) / 100 : 0;
  const abs = valor.toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${cents < 0 ? "−" : "+"}R$ ${abs}`;
}

/** `true` quando o valor do extrato é uma saída (débito). */
export function isDebito(valorCents: number): boolean {
  return valorCents < 0;
}

/**
 * Dentro da janela de undo (5s desde a criação do vínculo). Depois disso o
 * desfazer só acontece com motivo, e o banco audita (`UNDO_REASON_REQUIRED`).
 */
export function undoDentroDaJanela(createdAt: string, agora: Date = new Date()): boolean {
  const criado = new Date(createdAt);
  if (Number.isNaN(criado.getTime())) return false;
  return agora.getTime() - criado.getTime() <= UNDO_WINDOW_MS;
}

/** Melhor candidato do match (maior score); `null` quando não há par sugerido. */
export function melhorCandidato(candidatos: readonly MatchCandidate[]): MatchCandidate | null {
  if (candidatos.length === 0) return null;
  return [...candidatos].sort(
    (a, b) => b.score - a.score || a.delta_dias - b.delta_dias,
  )[0] ?? null;
}

/** Chave estável do alvo (`tipo:id`) para deduplicar o lote. */
export function chaveAlvo(candidato: Pick<MatchCandidate, "alvo_tipo" | "alvo_id">): string {
  return `${candidato.alvo_tipo}:${candidato.alvo_id}`;
}

/**
 * Melhor candidato que ainda não foi usado no lote. Como o alvo é único
 * (`reconciliation_links_tenant_alvo_uidx`), duas linhas não podem apontar para
 * o mesmo lançamento: a segunda escolhe o próximo livre ou fica sem par.
 */
export function melhorCandidatoLivre(
  candidatos: readonly MatchCandidate[],
  usados: ReadonlySet<string>,
): MatchCandidate | null {
  return melhorCandidato(candidatos.filter((candidato) => !usados.has(chaveAlvo(candidato))));
}

/** Data `yyyy-mm-dd` para exibição pt-BR (dd/mm/aaaa), sem deslocar o dia. */
export function formatarDataExtrato(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!match) return "—";
  return `${match[3]}/${match[2]}/${match[1]}`;
}

/**
 * Códigos de erro das RPCs/Edge em pt-BR. Sem este mapa a UI mostraria o código
 * cru (ex.: `RECONCILIATION_VALUE_MISMATCH`).
 */
const CONCILIACAO_ERROR_MESSAGES: Record<string, string> = {
  BANK_ACCOUNT_NOT_FOUND: "Conta bancária não encontrada.",
  BANK_LINE_NOT_FOUND: "Linha do extrato não encontrada.",
  RECONCILIATION_LINK_NOT_FOUND: "Vínculo de conciliação não encontrado.",
  RECONCILIATION_ALREADY_LINKED: "Esta linha do extrato já está conciliada.",
  RECONCILIATION_TARGET_ALREADY_LINKED:
    "Este lançamento já está conciliado com outra linha do extrato.",
  RECONCILIATION_LINE_IGNORED: "Linha ignorada não pode ser conciliada.",
  RECONCILIATION_LINE_RECONCILED: "Linha já conciliada não pode ser ignorada.",
  RECONCILIATION_TARGET_NOT_FOUND: "Lançamento de destino não encontrado.",
  RECONCILIATION_VALUE_MISMATCH:
    "O valor da linha difere do lançamento escolhido. O match exige valor exato.",
  RECONCILIATION_ENTRY_UNDO_FORBIDDEN:
    "Este vínculo criou um lançamento. Cancele o lançamento para desfazer.",
  UNDO_REASON_REQUIRED: "Informe o motivo para desfazer após os 5 segundos.",
  SUPPLIER_NOT_FOUND: "Fornecedor não encontrado.",
  CUSTOMER_NOT_FOUND: "Cliente não encontrado.",
  CUSTOMER_REQUIRED: "Selecione o cliente do lançamento.",
  FEATURE_DISABLED: "O recurso de conciliação não está disponível no plano atual.",
  FORBIDDEN: "Sem permissão para esta operação.",
  INVALID_BODY: "Dados inválidos.",
  STATEMENT_EMPTY: "O arquivo não tem lançamentos.",
  STATEMENT_TOO_MANY_LINES: "O arquivo tem mais lançamentos do que o limite (2.000).",
  STATEMENT_INVALID_DATE: "O arquivo tem uma data inválida.",
  STATEMENT_INVALID_AMOUNT: "O arquivo tem um valor inválido.",
  STATEMENT_INVALID_ROW: "O arquivo tem uma linha incompleta.",
  STATEMENT_INVALID_HEADER: "O CSV precisa de cabeçalho com as colunas data, descrição e valor.",
  STATEMENT_UNSUPPORTED_FORMAT: "Formato de arquivo não suportado. Use OFX ou CSV.",
};

/** Traduz o erro cru (código estável ou mensagem) para pt-BR legível. */
export function conciliacaoErrorMessage(raw: unknown, fallback: string): string {
  if (typeof raw !== "string" || raw.trim() === "") return fallback;
  const trimmed = raw.trim();
  const byCode = CONCILIACAO_ERROR_MESSAGES[trimmed];
  if (byCode) return byCode;
  if (/^[A-Z][A-Z0-9_]{2,63}$/.test(trimmed)) return fallback;
  return trimmed;
}

// ------------------------------------------------------------------ schemas
const bankAccountRowSchema = z.object({
  id: z.string(),
  tenant_id: z.string(),
  nome: z.string(),
  banco: z.string(),
  conta_ultimos4: z.string(),
  saldo_inicial_cents: z.number(),
  ativo: z.boolean(),
  created_at: z.string(),
});

export const bankAccountListSchema = z.array(bankAccountRowSchema);

const bankStatementRowSchema = z.object({
  id: z.string(),
  tenant_id: z.string(),
  account_id: z.string(),
  formato: z.enum(CONCILIACAO_FORMATOS),
  nome_arquivo: z.string(),
  periodo_ini: z.string(),
  periodo_fim: z.string(),
  saldo_ini_cents: z.number().nullable(),
  saldo_fim_cents: z.number().nullable(),
  linhas_total: z.number(),
  created_at: z.string(),
});

export const bankStatementListSchema = z.array(bankStatementRowSchema);

const bankLineRowSchema = z.object({
  id: z.string(),
  tenant_id: z.string(),
  statement_id: z.string(),
  data: z.string(),
  descricao: z.string(),
  valor_cents: z.number().int(),
  status: z.string(),
  motivo_ignorado: z.string().nullable(),
  created_at: z.string(),
});

const reconciliationLinkRowSchema = z.object({
  id: z.string(),
  tenant_id: z.string(),
  bank_line_id: z.string(),
  alvo_tipo: z.enum(["payable", "receivable", "manual"]),
  alvo_id: z.string().nullable(),
  motivo: z.string().nullable().catch(null),
  origem: z.enum(["match", "entry"]).catch("match"),
  created_by: z.string().nullable(),
  created_at: z.string(),
});

export const reconciliationLinkListSchema = z.array(reconciliationLinkRowSchema);

export function parseBankLines(raw: unknown): BankLine[] {
  const parsed = z.array(bankLineRowSchema).safeParse(raw ?? []);
  if (!parsed.success) throw new Error("Resposta inválida do extrato.");
  return parsed.data
    .filter((row) => isConciliacaoStatus(row.status))
    .map((row) => ({ ...row, status: row.status as ConciliacaoStatus }));
}

export const importStatementResponseSchema = z.object({
  statement_id: z.string(),
  linhas_total: z.number().int(),
  periodo_ini: z.string(),
  periodo_fim: z.string(),
  saldo_ini_cents: z.number().int().nullable(),
  saldo_fim_cents: z.number().int().nullable(),
  replayed: z.boolean(),
});
export type ImportStatementResponse = z.infer<typeof importStatementResponseSchema>;

export const matchSuggestionSchema = z.object({
  bank_line_id: z.string(),
  valor_cents: z.number().int(),
  data: z.string(),
  tolerancia_dias: z.number().int(),
  candidatos: z.array(
    z.object({
      alvo_tipo: z.enum(["payable", "receivable"]),
      alvo_id: z.string(),
      descricao: z.string(),
      valor_cents: z.number().int(),
      data: z.string(),
      delta_dias: z.number().int(),
      score: z.number().int(),
    }),
  ),
});

export const linkResponseSchema = z.object({
  linked: z.number().int(),
  link_ids: z.array(z.string()),
});

export const ignoreResponseSchema = z.object({
  ignored: z.number().int(),
});

export const undoResponseSchema = z.object({
  bank_line_id: z.string(),
  undone: z.boolean(),
  dentro_da_janela: z.boolean(),
});

export const createEntryResponseSchema = z.object({
  bank_line_id: z.string(),
  link_id: z.string(),
  alvo_tipo: z.enum(["payable", "receivable"]),
  alvo_id: z.string(),
  status: z.string(),
});

export const accountCreateResponseSchema = z.object({
  account_id: z.string(),
  replayed: z.boolean(),
});

// ------------------------------------------------------------- form schemas
export const contaBancariaSchema = z.object({
  nome: z.string().trim().min(1, "Informe o nome da conta.").max(120),
  banco: z.string().trim().min(1, "Informe o banco.").max(60),
  conta_ultimos4: z
    .string()
    .trim()
    .regex(/^[0-9]{4}$/, "Informe os 4 últimos dígitos."),
  saldo_inicial: z.string().trim().optional().default(""),
});
export type ContaBancariaInput = z.infer<typeof contaBancariaSchema>;

export const importarExtratoSchema = z.object({
  account_id: z.string().uuid("Selecione a conta."),
  formato: z.enum(CONCILIACAO_FORMATOS),
  nome_arquivo: z.string().trim().min(1).max(200),
});
export type ImportarExtratoInput = z.infer<typeof importarExtratoSchema>;

export const ignorarLinhasSchema = z.object({
  motivo: z.string().trim().min(3, "Informe o motivo (mínimo 3 caracteres).").max(200),
});
export type IgnorarLinhasInput = z.infer<typeof ignorarLinhasSchema>;

export const criarLancamentoSchema = z.object({
  categoria: z.string().trim().max(60).optional().default(""),
});
export type CriarLancamentoInput = z.infer<typeof criarLancamentoSchema>;

export const undoMotivoSchema = z.object({
  motivo: z.string().trim().min(3, "Informe o motivo (mínimo 3 caracteres).").max(200),
});
export type UndoMotivoInput = z.infer<typeof undoMotivoSchema>;
