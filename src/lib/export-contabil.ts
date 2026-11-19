import { z } from "zod";

/**
 * Export contábil (Fase 5 ADR-10, RF-36..38). Tipos, metadados e helpers puros
 * da tela `/app/financeiro/exportar`.
 *
 * Fronteira: o arquivo é gerado na Edge `export-ledger` e devolvido como
 * download; a UI só pede, baixa e mostra a trilha (`export_logs`). Nenhum
 * `tenant_id` sai daqui — o servidor resolve pelo JWT.
 */

export const EXPORT_FORMATOS = ["csv", "ofx", "sped"] as const;
export type ExportFormato = (typeof EXPORT_FORMATOS)[number];

export interface FormatoMeta {
  rotulo: string;
  descricao: string;
  extensao: string;
}

export const EXPORT_FORMATO_META: Record<ExportFormato, FormatoMeta> = {
  csv: {
    rotulo: "CSV",
    descricao: "Uma linha por movimento, com categoria e método de pagamento.",
    extensao: "csv",
  },
  ofx: {
    rotulo: "OFX",
    descricao: "Extrato conciliado para importar no sistema do contador.",
    extensao: "ofx",
  },
  sped: {
    rotulo: "SPED-resumo (gerencial)",
    descricao:
      "Resumo por categoria inspirado no bloco E1. É gerencial: não substitui o SPED fiscal oficial.",
    extensao: "txt",
  },
};

export const EXPORT_ESCOPOS = ["receber", "pagar", "fiscal"] as const;
export type ExportEscopo = (typeof EXPORT_ESCOPOS)[number];

export const EXPORT_ESCOPO_META: Record<ExportEscopo, { rotulo: string; descricao: string }> = {
  receber: {
    rotulo: "A receber",
    descricao: "Atendimentos recebidos (ledger) e cobranças avulsas recebidas.",
  },
  pagar: {
    rotulo: "A pagar",
    descricao: "Baixas de contas a pagar registradas no período.",
  },
  fiscal: {
    rotulo: "Fiscal",
    descricao: "NFC-e autorizadas, em contingência e canceladas do período.",
  },
};

/** O OFX sempre exporta o extrato conciliado inteiro (ADR-10). */
export const OFX_ESCOPO_AVISO =
  "O OFX exporta o extrato conciliado do período; o escopo vale para CSV e SPED-resumo.";

export const EXPORT_TIPO_LABEL: Record<string, string> = {
  ledger: "Recebimentos",
  payables: "Pagamentos",
  fiscal: "Notas fiscais",
  ofx: "Extrato OFX",
  sped: "SPED-resumo",
};

export const EXPORT_FORMATO_LABEL: Record<string, string> = {
  csv: "CSV",
  ofx: "OFX",
  sped: "SPED-resumo",
};

const exportLogSchema = z.object({
  id: z.string(),
  tipo: z.string(),
  periodo: z.string(),
  formato: z.string(),
  arquivo_path: z.string().nullable(),
  created_by: z.string().nullable(),
  created_at: z.string(),
});

export const exportLogListSchema = z.array(exportLogSchema);

export interface ExportLog {
  id: string;
  tipo: string;
  periodo: string;
  formato: string;
  arquivoPath: string | null;
  autorNome: string | null;
  createdAt: string;
}

/** Nome do arquivo entregue — contrato idêntico ao da Edge (`exportFileName`). */
export function exportFileName(
  formato: ExportFormato,
  escopo: ExportEscopo,
  periodoIni: string,
  periodoFim: string,
): string {
  return `export-${escopo}-${formato}-${periodoIni}_${periodoFim}.${EXPORT_FORMATO_META[formato].extensao}`;
}

/** Lê o nome do arquivo do `Content-Disposition` (fallback quando ausente). */
export function parseContentDispositionFilename(header: string | null): string | null {
  if (!header) return null;
  const match = /filename="?([^";]+)"?/i.exec(header);
  return match ? match[1].trim() : null;
}

/** Mensagem pt-BR para o código estável devolvido pela Edge. */
export function exportErrorMessage(codigo: string | null | undefined, fallback: string): string {
  if (!codigo) return fallback;
  if (codigo.includes("EMPTY_PERIOD")) {
    return "Sem movimentos no período. Ajuste o período ou o escopo — nenhum arquivo foi gerado.";
  }
  if (codigo.includes("RANGE_TOO_LARGE")) {
    return "Período longo demais para exportar. Escolha até 12 meses.";
  }
  if (codigo.includes("FEATURE_DISABLED")) {
    return "O export contábil não está incluído no plano atual.";
  }
  if (codigo.includes("FORBIDDEN")) {
    return "Apenas o administrador da empresa pode exportar.";
  }
  if (codigo.includes("INVALID_BODY")) {
    return "Período inválido. Confira as datas de início e fim.";
  }
  if (codigo.includes("UNAUTHENTICATED")) {
    return "Sessão expirada. Entre novamente para exportar.";
  }
  return fallback;
}

/** Data/hora legível em pt-BR (fuso do navegador). */
export function formatExportDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(date);
}

/** Linhas de log a partir do retorno do banco + nomes dos autores. */
export function toExportLogs(
  rows: unknown,
  autores: ReadonlyMap<string, string>,
): ExportLog[] {
  const parsed = exportLogListSchema.safeParse(rows);
  if (!parsed.success) return [];
  return parsed.data.map((row) => ({
    id: row.id,
    tipo: row.tipo,
    periodo: row.periodo,
    formato: row.formato,
    arquivoPath: row.arquivo_path,
    autorNome: row.created_by ? (autores.get(row.created_by) ?? null) : null,
    createdAt: row.created_at,
  }));
}

/** Dispara o download do arquivo já recebido da Edge. */
export function saveExportBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}
