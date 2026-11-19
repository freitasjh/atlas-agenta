// Tipos e leitura do fiscal (ADR-02; RF-01/RF-05/RF-06).
// Somente leitura via RLS (admin-only no banco): nenhuma escrita privilegiada,
// nenhuma credencial do emissor fiscal passa por aqui — emissão vive em Edge (ADR-03).
// O `tenant_id` nunca é filtro do cliente: o recorte vem do JWT via RLS.

import type { SupabaseClient } from "@supabase/supabase-js";

export const FISCAL_ORIGIN_TYPES = ["appointment", "sale"] as const;
export type FiscalOriginType = (typeof FISCAL_ORIGIN_TYPES)[number];

export const FISCAL_STATUSES = [
  "pendente",
  "autorizada",
  "contingencia",
  "rejeitada",
  "cancelada",
] as const;
export type FiscalStatus = (typeof FISCAL_STATUSES)[number];

export const FISCAL_EVENT_TYPES = [
  "emissao",
  "contingencia",
  "rejeicao",
  "cancelamento",
  "carta",
] as const;
export type FiscalEventType = (typeof FISCAL_EVENT_TYPES)[number];

export function isFiscalOriginType(value: unknown): value is FiscalOriginType {
  return (
    typeof value === "string" &&
    (FISCAL_ORIGIN_TYPES as readonly string[]).includes(value)
  );
}

export function isFiscalStatus(value: unknown): value is FiscalStatus {
  return (
    typeof value === "string" &&
    (FISCAL_STATUSES as readonly string[]).includes(value)
  );
}

export function isFiscalEventType(value: unknown): value is FiscalEventType {
  return (
    typeof value === "string" &&
    (FISCAL_EVENT_TYPES as readonly string[]).includes(value)
  );
}

export interface FiscalDocument {
  id: string;
  origem_tipo: FiscalOriginType;
  origem_id: string;
  numero: string | null;
  serie: string | null;
  chave_acesso: string | null;
  status: FiscalStatus;
  valor_cents: number;
  xml: string | null;
  danfe_url: string | null;
  created_at: string;
  authorized_at: string | null;
}

export interface FiscalEvent {
  id: string;
  fiscal_document_id: string;
  tipo: FiscalEventType;
  motivo: string | null;
  payload: Record<string, unknown>;
  created_at: string;
}

/** Lista fiscal do tenant (RLS admin-only; sem filtro de tenant no cliente). */
export async function listFiscalDocuments(
  client: SupabaseClient,
  options: { status?: FiscalStatus; limit?: number } = {},
): Promise<FiscalDocument[]> {
  let query = client
    .from("fiscal_documents")
    .select(
      "id, origem_tipo, origem_id, numero, serie, chave_acesso, status, valor_cents, xml, danfe_url, created_at, authorized_at",
    )
    .order("created_at", { ascending: false })
    .limit(options.limit ?? 50);
  if (options.status !== undefined) query = query.eq("status", options.status);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as FiscalDocument[];
}

/** Trilha auditável de um documento (append-only; ordenada por criação). */
export async function listFiscalEvents(
  client: SupabaseClient,
  fiscalDocumentId: string,
): Promise<FiscalEvent[]> {
  const { data, error } = await client
    .from("fiscal_events")
    .select("id, fiscal_document_id, tipo, motivo, payload, created_at")
    .eq("fiscal_document_id", fiscalDocumentId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as FiscalEvent[];
}

// ---------------------------------------------------------------------------
// Apresentação (ADR-03 RF-01/RF-03/RF-05): rótulos pt-BR, DANFE e contingência.
// Puro (sem request, sem segredo); coberto por `fiscal.test.ts`.
// ---------------------------------------------------------------------------

/** Rótulo pt-BR de cada status + se o documento tem valor fiscal. */
export const FISCAL_STATUS_META: Record<
  FiscalStatus,
  { rotulo: string; temValorFiscal: boolean; permiteCancelar: boolean }
> = {
  pendente: { rotulo: "Pendente", temValorFiscal: false, permiteCancelar: false },
  autorizada: { rotulo: "Autorizada", temValorFiscal: true, permiteCancelar: true },
  contingencia: { rotulo: "Contingência", temValorFiscal: false, permiteCancelar: false },
  rejeitada: { rotulo: "Rejeitada", temValorFiscal: false, permiteCancelar: false },
  cancelada: { rotulo: "Cancelada", temValorFiscal: false, permiteCancelar: false },
};

/** Variante do `Badge` por status (só apresentação; RLS decide o acesso). */
export function fiscalStatusVariant(status: FiscalStatus): "default" | "secondary" | "destructive" | "outline" {
  switch (status) {
    case "autorizada":
      return "default";
    case "rejeitada":
    case "cancelada":
      return "destructive";
    case "contingencia":
      return "secondary";
    default:
      return "outline";
  }
}

/** Formata a chave de 44 dígitos em blocos de 4 (leitura da DANFE). */
export function formatChaveAcesso(chave: string | null): string {
  if (!chave) return "—";
  const digitos = chave.replace(/[^0-9]/g, "");
  return digitos.replace(/(\d{4})(?=\d)/g, "$1 ").trim() || "—";
}

/**
 * Monta o payload do QR da DANFE a partir da chave (44 dígitos). Retorna `null`
 * quando não há chave (contingência/rejeição/pendente não têm QR válido).
 */
export function buildDanfeQrPayload(chaveAcesso: string | null): string | null {
  if (!chaveAcesso || !/^\d{44}$/.test(chaveAcesso)) return null;
  return `https://www.sefaz.gov.br/nfce/consulta?chNFe=${chaveAcesso}`;
}

/** Mensagem legível de contingência/rejeição para o operador (sem PII). */
export function fiscalMotivoLegivel(
  status: FiscalStatus,
  motivo: string | null,
): string {
  if (motivo && motivo.trim().length > 0) return motivo;
  if (status === "contingencia") {
    return "Documento em contingência, sem valor fiscal. Reemitir quando a SEFAZ responder.";
  }
  if (status === "rejeitada") {
    return "Documento rejeitado. Corrigir os dados e reemitir.";
  }
  return "—";
}
