import { useQuery } from "@tanstack/react-query";
import { z } from "zod";

import { supabase } from "@/lib/supabase";
import { tenantRangeUtc } from "@/lib/datetime";
import { useTenant } from "@/hooks/useTenant";
import { usePermissions } from "@/hooks/usePermissions";
import { useSegmentFeatures } from "@/hooks/useSegmentFeatures";

/**
 * Hook de dados do relatório de comissão por período (ADR-08, Fase 1b). Chama a
 * RPC `report_commissions(p_start, p_end, p_professional_id?)` da ADR-04
 * (`SECURITY INVOKER`) via `supabase.rpc(...)` — isolamento multi-tenant e RBAC
 * financeiro vêm 100% do RLS que a RPC herda, nunca reimplementados aqui.
 *
 * Fronteiras (herdadas, não reimplementadas):
 *   - Nenhum `tenant_id` trafega do cliente; a RPC o deriva do JWT sob RLS.
 *   - `professionalId` é conveniência de UI / defesa em profundidade (um admin
 *     filtrar um barbeiro); a trava real é o RLS por `professional_id`.
 *   - O fuso vive só em `datetime.ts`: este hook deriva as bordas UTC a partir
 *     do `timezone` do tenant (janela semiaberta `[start, end)`) e as envia à
 *     RPC como instantes absolutos. A RPC não reimplementa aritmética de fuso.
 *
 * Gating (CA-VIS-06): `enabled` só quando `useSegmentFeatures().commission` E
 * `canViewCommission` — para quem não pode ver (clínica/salão/legado, ou
 * receptionist), nenhum request de comissão é disparado.
 *
 * O retorno da RPC é dado externo não confiável (mesmo vindo do próprio banco):
 * validado por zod antes de usar; `total_commission_cents` e `appointment_count`
 * são inteiros (centavos inteiros, nunca float).
 */

const commissionReportRowSchema = z.object({
  professional_id: z.string(),
  professional_name: z.string(),
  // `bigint` no SQL → o PostgREST serializa como number no JSON.
  total_commission_cents: z.number().int(),
  appointment_count: z.number().int(),
});

const commissionReportSchema = z.array(commissionReportRowSchema);

export type CommissionReportRow = z.infer<typeof commissionReportRowSchema>;

const COMMISSION_REPORT_KEY = ["commission-report"] as const;

export function useCommissionReport({
  /** `YYYY-MM-DD` de início (inclusivo) no fuso do tenant. */
  startDate,
  /** `YYYY-MM-DD` de fim (inclusivo) no fuso do tenant. */
  endDate,
  /** `undefined`/`null` = todos; id = restringe a um profissional (conveniência de UI). */
  professionalId,
}: {
  startDate: string;
  endDate: string;
  professionalId?: string | null;
}) {
  const { data: tenant } = useTenant();
  const timeZone = tenant?.timezone;

  const features = useSegmentFeatures();
  const { canViewCommission } = usePermissions();

  // Normaliza para a `queryKey` e o parâmetro da RPC: string vazia / null → null.
  const normalizedProfessionalId = professionalId ? professionalId : null;

  return useQuery<CommissionReportRow[]>({
    queryKey: [
      ...COMMISSION_REPORT_KEY,
      { startDate, endDate, professionalId: normalizedProfessionalId },
    ],
    // Só dispara para quem pode ver comissão (gating de segmento + RBAC) e com
    // fuso resolvido. Fora disso, nenhum request de comissão (CA-VIS-06).
    enabled: !!timeZone && features.commission && canViewCommission,
    queryFn: async () => {
      const tz = timeZone as string;
      const range = tenantRangeUtc(startDate, endDate, tz);
      if (!range) throw new Error("Período inválido.");

      const { data, error } = await supabase.rpc("report_commissions", {
        p_start: range.startUtc.toISOString(),
        p_end: range.endUtc.toISOString(),
        p_professional_id: normalizedProfessionalId,
      });
      if (error) throw error;

      return commissionReportSchema.parse(data);
    },
  });
}
