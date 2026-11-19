import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { supabase } from "@/lib/supabase";
import {
  accountCreateResponseSchema,
  bankAccountListSchema,
  bankStatementListSchema,
  conciliacaoErrorMessage,
  createEntryResponseSchema,
  chaveAlvo,
  ignoreResponseSchema,
  importStatementResponseSchema,
  linkResponseSchema,
  matchSuggestionSchema,
  melhorCandidatoLivre,
  parseBankLines,
  reconciliationLinkListSchema,
  undoResponseSchema,
  type BankAccount,
  type BankLine,
  type BankStatement,
  type ImportStatementResponse,
  type MatchCandidate,
  type ReconciliationLink,
  type ReconciliationTarget,
} from "@/lib/conciliacao";

/**
 * Hooks da conciliação bancária (Fase 5 ADR-08, UI).
 *
 * Leitura via RLS (admin-only; recepção/profissional sem SELECT — a trava é a
 * política). Todo `enabled` vem do gating `conciliacao` da página: `false`/`null`
 * → nenhuma query disparada (`suppliers`/`customers` também ficam desligados).
 *
 * Escrita: RPCs admin (`reconciliation_*`) e a Edge `import-statement` (parse do
 * OFX/CSV + hash dedupe). Nenhuma escrita direta em tabela — não existe policy
 * de write; o cliente autenticado recebe 42501.
 */

export const CONCILIACAO_ACCOUNTS_KEY = ["conciliacao", "accounts"] as const;
export const CONCILIACAO_STATEMENTS_KEY = ["conciliacao", "statements"] as const;
export const CONCILIACAO_LINES_KEY = ["conciliacao", "lines"] as const;
export const CONCILIACAO_LINKS_KEY = ["conciliacao", "links"] as const;

const ACCOUNT_SELECT = "id, tenant_id, nome, banco, conta_ultimos4, saldo_inicial_cents, ativo, created_at";
const STATEMENT_SELECT =
  "id, tenant_id, account_id, formato, nome_arquivo, periodo_ini, periodo_fim, saldo_ini_cents, saldo_fim_cents, linhas_total, created_at";
const LINE_SELECT =
  "id, tenant_id, statement_id, data, descricao, valor_cents, status, motivo_ignorado, created_at";
const LINK_SELECT = "id, tenant_id, bank_line_id, alvo_tipo, alvo_id, motivo, origem, created_by, created_at";

export function useBankAccounts(enabled: boolean) {
  return useQuery<BankAccount[]>({
    queryKey: CONCILIACAO_ACCOUNTS_KEY,
    enabled,
    staleTime: 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("bank_accounts")
        .select(ACCOUNT_SELECT)
        .eq("ativo", true)
        .order("nome", { ascending: true })
        .limit(50);
      if (error) throw error;
      return bankAccountListSchema.parse(data ?? []);
    },
  });
}

export function useBankStatements(accountId: string | null, enabled: boolean) {
  return useQuery<BankStatement[]>({
    queryKey: [...CONCILIACAO_STATEMENTS_KEY, accountId],
    enabled: enabled && accountId !== null,
    staleTime: 30 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("bank_statements")
        .select(STATEMENT_SELECT)
        .eq("account_id", accountId as string)
        .order("periodo_fim", { ascending: false })
        .limit(24);
      if (error) throw error;
      return bankStatementListSchema.parse(data ?? []);
    },
  });
}

export function useBankLines(statementId: string | null, enabled: boolean) {
  return useQuery<BankLine[]>({
    queryKey: [...CONCILIACAO_LINES_KEY, statementId],
    enabled: enabled && statementId !== null,
    staleTime: 15 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("bank_lines")
        .select(LINE_SELECT)
        .eq("statement_id", statementId as string)
        .order("data", { ascending: true })
        .limit(2000);
      if (error) throw error;
      return parseBankLines(data ?? []);
    },
  });
}

/** Vínculos das linhas do extrato aberto (para undo e para saber a origem). */
export function useReconciliationLinks(
  statementId: string | null,
  lineIds: readonly string[],
  enabled: boolean,
) {
  return useQuery<ReconciliationLink[]>({
    queryKey: [...CONCILIACAO_LINKS_KEY, statementId, lineIds.length],
    enabled: enabled && lineIds.length > 0,
    staleTime: 15 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("reconciliation_links")
        .select(LINK_SELECT)
        .in("bank_line_id", [...lineIds])
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      return reconciliationLinkListSchema.parse(data ?? []);
    },
  });
}

/** Sugestões de match da linha (valor exato + janela de 2 dias, no banco). */
export function useSuggestMatches(bankLineId: string | null, enabled: boolean) {
  return useQuery<MatchCandidate[]>({
    queryKey: [...CONCILIACAO_LINES_KEY, "matches", bankLineId],
    enabled: enabled && bankLineId !== null,
    staleTime: 10 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("reconciliation_suggest_matches", {
        p_bank_line_id: bankLineId as string,
      });
      if (error) {
        throw new Error(
          conciliacaoErrorMessage(error.message, "Não foi possível buscar os lançamentos."),
        );
      }
      const parsed = matchSuggestionSchema.safeParse(data);
      if (!parsed.success) throw new Error("Resposta inválida do match.");
      return parsed.data.candidatos;
    },
  });
}

function invalidateConciliacao(queryClient: ReturnType<typeof useQueryClient>) {
  void queryClient.invalidateQueries({ queryKey: CONCILIACAO_ACCOUNTS_KEY });
  void queryClient.invalidateQueries({ queryKey: CONCILIACAO_STATEMENTS_KEY });
  void queryClient.invalidateQueries({ queryKey: CONCILIACAO_LINES_KEY });
  void queryClient.invalidateQueries({ queryKey: CONCILIACAO_LINKS_KEY });
}

export function useCreateBankAccount() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      nome: string;
      banco: string;
      conta_ultimos4: string;
      saldo_inicial_cents: number;
    }): Promise<{ account_id: string; replayed: boolean }> => {
      const { data, error } = await supabase.rpc("reconciliation_account_create", {
        p_nome: input.nome,
        p_banco: input.banco,
        p_conta_ultimos4: input.conta_ultimos4,
        p_saldo_inicial_cents: input.saldo_inicial_cents,
      });
      if (error) {
        throw new Error(
          conciliacaoErrorMessage(error.message, "Não foi possível criar a conta bancária."),
        );
      }
      const parsed = accountCreateResponseSchema.safeParse(data);
      if (!parsed.success) throw new Error("Resposta inválida da conta bancária.");
      return parsed.data;
    },
    onSuccess: () => invalidateConciliacao(queryClient),
  });
}

export interface ImportStatementInput {
  account_id: string;
  formato: "ofx" | "csv";
  nome_arquivo: string;
  conteudo: string;
}

/** Import pela Edge: parse + hash dedupe + gravação atômica. */
export function useImportStatement() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: ImportStatementInput): Promise<ImportStatementResponse> => {
      const { data, error } = await supabase.functions.invoke("import-statement", {
        body: input,
      });
      if (error) {
        let code: string | undefined;
        let message: string | undefined;
        const context = (error as { context?: unknown }).context;
        if (context && typeof context === "object" && "clone" in context) {
          try {
            const body = (await (context as Response).clone().json()) as Record<string, unknown>;
            code = typeof body.code === "string" ? body.code : undefined;
            message = typeof body.message === "string" ? body.message : undefined;
          } catch {
            code = undefined;
          }
        }
        throw new Error(
          conciliacaoErrorMessage(
            message ?? code,
            "Não foi possível importar o extrato. Verifique o arquivo.",
          ),
        );
      }
      const parsed = importStatementResponseSchema.safeParse(data);
      if (!parsed.success) throw new Error("Resposta inválida da importação.");
      return parsed.data;
    },
    onSuccess: () => invalidateConciliacao(queryClient),
  });
}

export interface LinkLinesItem {
  bank_line_id: string;
  alvo_tipo: ReconciliationTarget;
  alvo_id: string | null;
}

export function useLinkLines() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (items: LinkLinesItem[]): Promise<{ linked: number; link_ids: string[] }> => {
      const { data, error } = await supabase.rpc("reconciliation_link", { p_links: items });
      if (error) {
        throw new Error(
          conciliacaoErrorMessage(error.message, "Não foi possível conciliar as linhas."),
        );
      }
      const parsed = linkResponseSchema.safeParse(data);
      if (!parsed.success) throw new Error("Resposta inválida da conciliação.");
      return parsed.data;
    },
    onSuccess: () => invalidateConciliacao(queryClient),
  });
}

/**
 * Conciliação em LOTE: para cada linha pede as sugestões ao banco e concilia a
 * melhor (valor exato + ≤2 dias). Linhas sem par ficam pendentes e são contadas
 * — nunca se inventa vínculo.
 *
 * O alvo é único por tenant (`reconciliation_links_tenant_alvo_uidx`): duas
 * linhas NÃO podem linkar o mesmo lançamento. O lote carrega um Set de alvos
 * usados, escolhe o próximo candidato livre e, quando não sobra nenhum, marca a
 * linha como `sem_match` — jamais deixa a RPC abortar o lote inteiro.
 */
export function useConciliarLote() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (
      lineIds: readonly string[],
    ): Promise<{ linked: number; sem_match: number; link_ids: string[] }> => {
      const ids = [...lineIds].slice(0, 50);
      const pares: LinkLinesItem[] = [];
      const alvosUsados = new Set<string>();
      let semMatch = 0;

      for (const id of ids) {
        const { data, error } = await supabase.rpc("reconciliation_suggest_matches", {
          p_bank_line_id: id,
        });
        if (error) {
          throw new Error(
            conciliacaoErrorMessage(error.message, "Não foi possível buscar os lançamentos."),
          );
        }
        const parsed = matchSuggestionSchema.safeParse(data);
        if (!parsed.success) throw new Error("Resposta inválida do match.");
        const best = melhorCandidatoLivre(parsed.data.candidatos, alvosUsados);
        if (!best) {
          semMatch += 1;
          continue;
        }
        alvosUsados.add(chaveAlvo(best));
        pares.push({ bank_line_id: id, alvo_tipo: best.alvo_tipo, alvo_id: best.alvo_id });
      }

      if (pares.length === 0) return { linked: 0, sem_match: semMatch, link_ids: [] };

      const { data, error } = await supabase.rpc("reconciliation_link", { p_links: pares });
      if (error) {
        throw new Error(
          conciliacaoErrorMessage(error.message, "Não foi possível conciliar as linhas."),
        );
      }
      const parsed = linkResponseSchema.safeParse(data);
      if (!parsed.success) throw new Error("Resposta inválida da conciliação.");
      return { linked: parsed.data.linked, sem_match: semMatch, link_ids: parsed.data.link_ids };
    },
    onSuccess: () => invalidateConciliacao(queryClient),
  });
}

export function useIgnoreLines() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { bank_line_ids: string[]; motivo: string }): Promise<{ ignored: number }> => {
      const { data, error } = await supabase.rpc("reconciliation_ignore", {
        p_bank_line_ids: input.bank_line_ids,
        p_motivo: input.motivo,
      });
      if (error) {
        throw new Error(
          conciliacaoErrorMessage(error.message, "Não foi possível ignorar as linhas."),
        );
      }
      const parsed = ignoreResponseSchema.safeParse(data);
      if (!parsed.success) throw new Error("Resposta inválida do ignorar.");
      return parsed.data;
    },
    onSuccess: () => invalidateConciliacao(queryClient),
  });
}

export function useCreateEntry() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      bank_line_id: string;
      supplier_id: string | null;
      customer_id: string | null;
      categoria: string | null;
    }): Promise<{ alvo_tipo: "payable" | "receivable"; alvo_id: string; link_id: string }> => {
      const { data, error } = await supabase.rpc("reconciliation_create_entry", {
        p_bank_line_id: input.bank_line_id,
        p_supplier_id: input.supplier_id,
        p_customer_id: input.customer_id,
        p_categoria: input.categoria,
      });
      if (error) {
        throw new Error(
          conciliacaoErrorMessage(error.message, "Não foi possível criar o lançamento."),
        );
      }
      const parsed = createEntryResponseSchema.safeParse(data);
      if (!parsed.success) throw new Error("Resposta inválida do lançamento.");
      return parsed.data;
    },
    onSuccess: () => invalidateConciliacao(queryClient),
  });
}

/**
 * Desfaz vínculo(s). Sem motivo a RPC aceita só dentro de 5s; depois exige
 * motivo (`UNDO_REASON_REQUIRED`). O toast de undo usa esta mutation em lote.
 */
export function useUndoLinks() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      link_ids: string[];
      motivo?: string | null;
    }): Promise<{ undone: number }> => {
      let undone = 0;
      let ultimoErro: string | null = null;
      for (const linkId of input.link_ids) {
        const { error } = await supabase.rpc("reconciliation_undo", {
          p_link_id: linkId,
          p_motivo: input.motivo ?? null,
        });
        if (error) {
          ultimoErro = conciliacaoErrorMessage(error.message, "Não foi possível desfazer.");
          continue;
        }
        undone += 1;
      }
      if (undone === 0 && ultimoErro !== null) throw new Error(ultimoErro);
      return { undone };
    },
    onSuccess: () => invalidateConciliacao(queryClient),
  });
}

/** Undo de um vínculo (usado pelo diálogo auditado depois da janela). */
export function useUndoLink() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { link_id: string; motivo: string | null }): Promise<{ undone: boolean }> => {
      const { data, error } = await supabase.rpc("reconciliation_undo", {
        p_link_id: input.link_id,
        p_motivo: input.motivo,
      });
      if (error) {
        throw new Error(conciliacaoErrorMessage(error.message, "Não foi possível desfazer."));
      }
      const parsed = undoResponseSchema.safeParse(data);
      if (!parsed.success) throw new Error("Resposta inválida do desfazer.");
      return { undone: parsed.data.undone };
    },
    onSuccess: () => invalidateConciliacao(queryClient),
  });
}

/** Contadores do extrato aberto (UI; nada de request extra). */
export function resumoExtrato(lines: readonly BankLine[]): {
  pendentes: number;
  conciliadas: number;
  ignoradas: number;
  entradas_cents: number;
  saidas_cents: number;
} {
  let pendentes = 0;
  let conciliadas = 0;
  let ignoradas = 0;
  let entradas = 0;
  let saidas = 0;
  for (const line of lines) {
    if (line.status === "pendente") pendentes += 1;
    else if (line.status === "conciliado") conciliadas += 1;
    else ignoradas += 1;
    if (line.valor_cents > 0) entradas += line.valor_cents;
    else saidas += line.valor_cents;
  }
  return {
    pendentes,
    conciliadas,
    ignoradas,
    entradas_cents: entradas,
    saidas_cents: saidas,
  };
}

/** Garante que o array de ids não muda de identidade em re-render (query key). */
export function idsDeLinhas(lines: readonly BankLine[]): string[] {
  return lines.map((line) => line.id);
}
