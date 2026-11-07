import { useQuery } from "@tanstack/react-query";
import { z } from "zod";

import { supabase } from "@/lib/supabase";
import { tenantRangeUtc } from "@/lib/datetime";
import { useTenant } from "@/hooks/useTenant";
import { usePermissions } from "@/hooks/usePermissions";
import { useSegmentFeatures } from "@/hooks/useSegmentFeatures";
import { PAYMENT_METHODS, type FinancialSummary } from "@/types/payments";

/**
 * Resumo financeiro admin (ADR-005 §2). Chama a RPC `financial_summary`
 * (`security invoker`) via `supabase.rpc(...)` — isolamento e RBAC vêm 100% do
 * RLS que a RPC herda, nunca reimplementados aqui.
 *
 * Fronteiras (herdadas, não reimplementadas):
 *   - Nenhum `tenant_id` trafega do cliente; a RPC o deriva do JWT sob RLS.
 *   - O fuso vive em `datetime.ts`: as bordas UTC derivam do `timezone` do
 *     tenant (janela semiaberta `[start, end)`) e seguem à RPC como instantes.
 *
 * Gating: `enabled` só quando o fuso resolveu E `canViewFinancials` E
 * `payments === true` — fora disso (recepção/profissional, clínica/legado),
 * nenhum request financeiro é disparado.
 *
 * O retorno é dado externo não confiável: validado por zod antes de usar.
 * Centavos inteiros, nunca float.
 */

const methodRowSchema = z.object({
  method: z.enum(PAYMENT_METHODS),
  amount_cents: z.number().int(),
  tip_cents: z.number().int(),
  count: z.number().int(),
});

export const financialSummarySchema = z.object({
  period: z.object({ from: z.string(), to: z.string() }),
  received_service_cents: z.number().int(),
  received_tips_cents: z.number().int(),
  received_total_cents: z.number().int(),
  receivable_cents: z.number().int(),
  open_cents: z.number().int(),
  by_method: z.array(methodRowSchema).length(5),
});

export const FINANCIAL_SUMMARY_KEY = ["financial-summary"] as const;

export function useFinancialSummary({
  /** `YYYY-MM-DD` de início (inclusivo) no fuso do tenant. */
  startDate,
  /** `YYYY-MM-DD` de fim (inclusivo) no fuso do tenant. */
  endDate,
}: {
  startDate: string;
  endDate: string;
}) {
  const { data: tenant } = useTenant();
  const timeZone = tenant?.timezone;

  const { canViewFinancials } = usePermissions();
  const { payments } = useSegmentFeatures();

  return useQuery<FinancialSummary>({
    queryKey: [...FINANCIAL_SUMMARY_KEY, startDate, endDate],
    // Só dispara para quem pode ver finanças (admin + segmento com
    // `payments`) e com fuso resolvido. Fora disso, nenhum request.
    enabled: !!timeZone && canViewFinancials && payments === true,
    staleTime: 30_000,
    queryFn: async () => {
      const tz = timeZone as string;
      const range = tenantRangeUtc(startDate, endDate, tz);
      if (!range) throw new Error("Período inválido.");

      const { data, error } = await supabase.rpc("financial_summary", {
        p_from: range.startUtc.toISOString(),
        p_to: range.endUtc.toISOString(),
      });
      if (error) throw error;

      return financialSummarySchema.parse(data) as FinancialSummary;
    },
  });
}
