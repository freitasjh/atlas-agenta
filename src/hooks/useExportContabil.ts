import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  type ExportEscopo,
  type ExportFormato,
  type ExportLog,
  exportErrorMessage,
  exportFileName,
  parseContentDispositionFilename,
  toExportLogs,
} from "@/lib/export-contabil";
import { env } from "@/lib/env";
import { supabase } from "@/lib/supabase";

/**
 * Hooks do export contábil (Fase 5 ADR-10, UI).
 *
 * `enabled` vem do gating da página (`exportContabil` + segmento): `false`/`null`
 * não dispara nenhuma request — nem de log, nem de download. O arquivo é
 * gerado pela Edge com o JWT do usuário; a UI só transporta o corpo.
 */

export const EXPORT_CONTABIL_KEY = ["export-contabil"] as const;

export class ExportRequestError extends Error {
  readonly code: string | null;

  constructor(code: string | null, message: string) {
    super(message);
    this.name = "ExportRequestError";
    this.code = code;
  }
}

interface ExportLogRow {
  id: string;
  tipo: string;
  periodo: string;
  formato: string;
  arquivo_path: string | null;
  created_by: string | null;
  created_at: string;
}

async function loadAutores(ids: readonly string[]): Promise<Map<string, string>> {
  const nomes = new Map<string, string>();
  if (ids.length === 0) return nomes;
  const { data, error } = await supabase
    .from("profiles")
    .select("id, full_name")
    .in("id", [...ids]);
  if (error) return nomes;
  for (const row of (data ?? []) as Array<{ id?: unknown; full_name?: unknown }>) {
    if (typeof row.id === "string" && typeof row.full_name === "string" && row.full_name !== "") {
      nomes.set(row.id, row.full_name);
    }
  }
  return nomes;
}

/**
 * Trilha de exports (`export_logs`, RLS admin-only do ADR-09). Lista os últimos
 * 50 com autor e data. Nunca pede `tenant_id` — o RLS resolve pelo JWT.
 */
export function useExportLogs(enabled: boolean) {
  return useQuery<ExportLog[]>({
    queryKey: [...EXPORT_CONTABIL_KEY, "logs"],
    enabled,
    staleTime: 30 * 1000,
    retry: false,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("export_logs")
        .select("id, tipo, periodo, formato, arquivo_path, created_by, created_at")
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw new Error("Não foi possível carregar a trilha de exports.");

      const rows = (data ?? []) as ExportLogRow[];
      const ids = [...new Set(rows.map((row) => row.created_by).filter((id): id is string => Boolean(id)))];
      const autores = await loadAutores(ids);
      return toExportLogs(rows, autores);
    },
  });
}

export interface ExportRequest {
  /** `YYYY-MM-DD` no fuso do tenant. */
  periodoIni: string;
  periodoFim: string;
  /** Bordas absolutas derivadas do fuso do tenant (`tenantRangeUtc`). */
  ini: string;
  fim: string;
  formato: ExportFormato;
  escopo: ExportEscopo;
}

export interface ExportResult {
  filename: string;
  blob: Blob;
}

async function errorFromResponse(response: Response): Promise<ExportRequestError> {
  let code: string | null = null;
  let message = "";
  try {
    const body = (await response.json()) as { code?: unknown; message?: unknown };
    if (typeof body.code === "string") code = body.code;
    if (typeof body.message === "string") message = body.message;
  } catch {
    // corpo não-JSON: usa o fallback pt-BR abaixo.
  }
  return new ExportRequestError(
    code,
    message !== "" ? message : exportErrorMessage(code, "Não foi possível gerar o arquivo."),
  );
}

/**
 * Pede o arquivo à Edge e entrega o Blob pronto para download. O log de entrega
 * é gravado no servidor antes da resposta — se falhar, não há arquivo.
 */
export function useExportLedger() {
  const queryClient = useQueryClient();

  return useMutation<ExportResult, ExportRequestError, ExportRequest>({
    mutationFn: async (input) => {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) {
        throw new ExportRequestError("UNAUTHENTICATED", exportErrorMessage("UNAUTHENTICATED", "Sessão expirada."));
      }

      const response = await fetch(`${env.VITE_SUPABASE_URL}/functions/v1/export-ledger`, {
        method: "POST",
        headers: {
          apikey: env.VITE_SUPABASE_ANON_KEY,
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          periodo_ini: input.periodoIni,
          periodo_fim: input.periodoFim,
          ini: input.ini,
          fim: input.fim,
          formato: input.formato,
          escopo: input.escopo,
        }),
      });

      if (!response.ok) {
        throw await errorFromResponse(response);
      }

      const blob = await response.blob();
      const filename =
        parseContentDispositionFilename(response.headers.get("Content-Disposition")) ??
        exportFileName(input.formato, input.escopo, input.periodoIni, input.periodoFim);

      return { filename, blob };
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [...EXPORT_CONTABIL_KEY, "logs"] });
    },
  });
}
