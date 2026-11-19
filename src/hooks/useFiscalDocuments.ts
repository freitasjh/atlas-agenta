import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";

import { supabase } from "@/lib/supabase";
import {
  isFiscalStatus,
  type FiscalDocument,
  type FiscalEvent,
  type FiscalOriginType,
  type FiscalStatus,
} from "@/lib/fiscal";

export const FISCAL_DOCUMENTS_KEY = ["fiscal", "documents"] as const;

export interface NfceFiltros {
  status?: FiscalStatus;
  busca?: string;
}

const documentSchema = z.object({
  id: z.string(),
  origem_tipo: z.enum(["appointment", "sale"]),
  origem_id: z.string(),
  numero: z.string().nullable(),
  serie: z.string().nullable(),
  chave_acesso: z.string().nullable(),
  status: z.string(),
  valor_cents: z.number(),
  xml: z.string().nullable(),
  danfe_url: z.string().nullable(),
  created_at: z.string(),
  authorized_at: z.string().nullable(),
});

const eventSchema = z.object({
  id: z.string(),
  fiscal_document_id: z.string(),
  tipo: z.string(),
  motivo: z.string().nullable(),
  payload: z.record(z.unknown()).optional().default({}),
  created_at: z.string(),
});

function parseDocument(raw: unknown): FiscalDocument | null {
  const parsed = documentSchema.safeParse(raw);
  if (!parsed.success) return null;
  if (!isFiscalStatus(parsed.data.status)) return null;
  return {
    ...parsed.data,
    origem_tipo: parsed.data.origem_tipo as FiscalOriginType,
    status: parsed.data.status,
    payload: undefined,
  } as FiscalDocument;
}

function parseEvent(raw: unknown): FiscalEvent | null {
  const parsed = eventSchema.safeParse(raw);
  if (!parsed.success) return null;
  return {
    id: parsed.data.id,
    fiscal_document_id: parsed.data.fiscal_document_id,
    tipo: parsed.data.tipo as FiscalEvent["tipo"],
    motivo: parsed.data.motivo,
    payload: (parsed.data.payload ?? {}) as Record<string, unknown>,
    created_at: parsed.data.created_at,
  };
}

/**
 * Lista fiscal do tenant (RLS admin-only). `enabled` vem do gating `nfce` da
 * página: `false`/`null` → query desabilitada, zero request a `fiscal_*`
 * (critério ADR-03 §3). Sem filtro de tenant no cliente (RLS via JWT).
 */
export function useFiscalDocuments(filtros: NfceFiltros, enabled: boolean) {
  return useQuery({
    queryKey: [...FISCAL_DOCUMENTS_KEY, filtros.status ?? "todas", filtros.busca?.trim().toLowerCase() ?? ""],
    queryFn: async (): Promise<FiscalDocument[]> => {
      let query = supabase
        .from("fiscal_documents")
        .select(
          "id, origem_tipo, origem_id, numero, serie, chave_acesso, status, valor_cents, xml, danfe_url, created_at, authorized_at",
        )
        .order("created_at", { ascending: false })
        .limit(100);
      if (filtros.status !== undefined) query = query.eq("status", filtros.status);
      const { data, error } = await query;
      if (error) throw error;
      const docs = ((data ?? []) as unknown[])
        .map(parseDocument)
        .filter((d): d is FiscalDocument => d !== null);
      const termo = filtros.busca?.trim().toLowerCase();
      if (!termo) return docs;
      return docs.filter(
        (d) =>
          (d.numero ?? "").toLowerCase().includes(termo) ||
          (d.chave_acesso ?? "").toLowerCase().includes(termo),
      );
    },
    enabled,
    staleTime: 30 * 1000,
    retry: false,
  });
}

/** Trilha auditável de um documento (só quando o modal DANFE abre). */
export function useFiscalEvents(fiscalDocumentId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: [...FISCAL_DOCUMENTS_KEY, "eventos", fiscalDocumentId],
    queryFn: async (): Promise<FiscalEvent[]> => {
      const { data, error } = await supabase
        .from("fiscal_events")
        .select("id, fiscal_document_id, tipo, motivo, payload, created_at")
        .eq("fiscal_document_id", fiscalDocumentId as string)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return ((data ?? []) as unknown[])
        .map(parseEvent)
        .filter((e): e is FiscalEvent => e !== null);
    },
    enabled: enabled && fiscalDocumentId !== null,
    staleTime: 30 * 1000,
    retry: false,
  });
}

export interface IssueNfceInput {
  origem_tipo: FiscalOriginType;
  origem_id: string;
  valor_cents: number;
  destinatario_documento?: string;
}

/** Emissão idempotente via Edge `issue-nfce` (replay devolve `replayed`). */
export function useIssueNfce() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (
      input: IssueNfceInput,
    ): Promise<{ document: FiscalDocument; replayed: boolean }> => {
      const { data, error } = await supabase.functions.invoke("issue-nfce", {
        body: input,
      });
      if (error) {
        const message =
          (data as { message?: unknown } | null)?.message;
        throw new Error(
          typeof message === "string" && message.length > 0
            ? message
            : (error.message ?? "Não foi possível emitir a nota fiscal."),
        );
      }
      const document = parseDocument((data as { document?: unknown } | null)?.document);
      if (!document) throw new Error("Resposta inválida da emissão fiscal.");
      return { document, replayed: (data as { replayed?: boolean })?.replayed === true };
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: FISCAL_DOCUMENTS_KEY });
    },
  });
}

export interface CancelNfceInput {
  fiscal_document_id: string;
  acao: "cancelamento" | "carta";
  motivo: string;
}

/** Cancelamento/carta via Edge `cancel-nfce` (motivo auditável obrigatório). */
export function useCancelNfce() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CancelNfceInput): Promise<{ replayed: boolean }> => {
      const { data, error } = await supabase.functions.invoke("cancel-nfce", {
        body: input,
      });
      if (error) {
        const message =
          (data as { message?: unknown } | null)?.message;
        throw new Error(
          typeof message === "string" && message.length > 0
            ? message
            : (error.message ?? "Não foi possível concluir a operação fiscal."),
        );
      }
      return { replayed: (data as { replayed?: boolean })?.replayed === true };
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: FISCAL_DOCUMENTS_KEY });
    },
  });
}
