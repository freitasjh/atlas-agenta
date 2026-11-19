import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useCurrentUser } from "@/hooks/useCurrentUser";
import { tenantRangeUtc } from "@/lib/datetime";
import {
  cashflowSchema,
  dreErrorMessage,
  dreReportSchema,
  type Cashflow,
  type DreRegime,
  type DreReport,
} from "@/lib/dre";
import { supabase } from "@/lib/supabase";

/**
 * Hooks do DRE + fluxo de caixa (Fase 5 ADR-09, UI).
 *
 * A RPC é admin-only no banco (RLS + gate interno) e gated por entitlement
 * `dre_fluxo`: todo `enabled` vem da página; `false`/`null` → nenhuma request.
 *
 * Fuso: o cliente deriva as bordas absolutas do período a partir do
 * `tenants.timezone` (`tenantRangeUtc`, janela semiaberta) e envia instantes —
 * a RPC nunca reinterpreta fuso nem recebe `tenant_id` do cliente.
 */

export const DRE_KEY = ["dre"] as const;

export interface DreParams {
  /** `YYYY-MM-DD` (inclusivo) no fuso do tenant. */
  startDate: string;
  /** `YYYY-MM-DD` (inclusivo) no fuso do tenant. */
  endDate: string;
  regime: DreRegime;
}

export function useDreReport({ startDate, endDate, regime, enabled }: DreParams & { enabled: boolean }) {
  const { tenant } = useCurrentUser();
  const timeZone = tenant?.timezone ?? null;

  return useQuery<DreReport>({
    queryKey: [...DRE_KEY, "report", startDate, endDate, regime, timeZone],
    enabled: enabled && timeZone !== null,
    // O DRE é fechamento: não precisa refetch agressivo enquanto a tela está aberta.
    staleTime: 60 * 1000,
    queryFn: async () => {
      const range = tenantRangeUtc(startDate, endDate, timeZone as string);
      if (!range) throw new Error("Período inválido. Confira as datas de início e fim.");

      const { data, error } = await supabase.rpc("dre_report", {
        p_ini: range.startUtc.toISOString(),
        p_fim: range.endUtc.toISOString(),
        p_regime: regime,
      });
      if (error) {
        throw new Error(dreErrorMessage(error.message, "Não foi possível carregar o DRE."));
      }
      const parsed = dreReportSchema.safeParse(data);
      if (!parsed.success) throw new Error("Resposta inválida do DRE.");
      return parsed.data;
    },
  });
}

/** Fluxo de caixa de 30 dias a partir de `baseDate` (`YYYY-MM-DD` no fuso do tenant). */
export function useCashflow30d({
  baseDate,
  enabled,
}: {
  baseDate: string;
  enabled: boolean;
}) {
  const { tenant } = useCurrentUser();
  const timeZone = tenant?.timezone ?? null;

  return useQuery<Cashflow>({
    queryKey: [...DRE_KEY, "cashflow", baseDate, timeZone],
    enabled: enabled && timeZone !== null,
    staleTime: 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("cashflow_30d", { p_base: baseDate });
      if (error) {
        throw new Error(dreErrorMessage(error.message, "Não foi possível carregar o fluxo de caixa."));
      }
      const parsed = cashflowSchema.safeParse(data);
      if (!parsed.success) throw new Error("Resposta inválida do fluxo de caixa.");
      return parsed.data;
    },
  });
}

export interface DreExportInput {
  /** `YYYY-MM-DD..YYYY-MM-DD` do período exportado. */
  periodo: string;
  arquivoPath: string;
}

/**
 * Registra o export CSV do DRE em `export_logs` (RPC admin, gated por
 * `dre_fluxo`). O download acontece no cliente; o log é a trilha auditável.
 */
export function useLogDreExport() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: DreExportInput): Promise<{ id: string }> => {
      const { data, error } = await supabase.rpc("export_log_create", {
        p_tipo: "dre",
        p_periodo: input.periodo,
        p_formato: "csv",
        p_arquivo_path: input.arquivoPath,
      });
      if (error) {
        throw new Error(dreErrorMessage(error.message, "Não foi possível registrar o export."));
      }
      const id = (data as { id?: unknown } | null)?.id;
      if (typeof id !== "string") throw new Error("Resposta inválida do registro de export.");
      return { id };
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [...DRE_KEY, "exports"] });
    },
  });
}
