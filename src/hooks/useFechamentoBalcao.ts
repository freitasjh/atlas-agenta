import { useQuery } from "@tanstack/react-query";
import { z } from "zod";

import { supabase } from "@/lib/supabase";
import { tenantRangeUtc } from "@/lib/datetime";
import { useTenant } from "@/hooks/useTenant";
import { usePermissions } from "@/hooks/usePermissions";
import { useSegmentFeatures } from "@/hooks/useSegmentFeatures";
import { PAYMENT_METHODS, type PaymentMethod } from "@/types/payments";

/**
 * Fechamento de balcão só-leitura (ADR-24): agregação na tela a partir das
 * linhas do ledger lidas sob RLS admin (ADR-24 §2 — sem RPC novo, sem tabela
 * nova, sem escrita). `onlyBalcao` recorta por `appointments.origin`.
 *
 * Leitura direta do ledger sob RLS admin-only; gating igual ao painel
 * (`canViewFinancials` + `payments === true`). SemPII além de `operator_name`
 * operacional (nunca log). Teto de 500 linhas por período: o fechamento
 * padrão é o dia; períodos longos são leitura do painel financeiro.
 */
const ROW_LIMIT = 500;

const balcaoRowSchema = z
  .object({
    id: z.string(),
    received_at: z.string(),
    method: z.enum(PAYMENT_METHODS),
    amount_cents: z.number().int(),
    tip_cents: z.number().int(),
    voided_at: z.string().nullable(),
    received_by: z.string().nullable(),
    appointments: z
      .object({
        origin: z.enum(["agendado", "walk_in"]).optional(),
        customers: z.object({ name: z.string() }).nullable(),
      })
      .nullable(),
    operator: z.object({ full_name: z.string() }).nullable(),
  })
  .passthrough();

const BALCAO_SELECT =
  "id, received_at, method, amount_cents, tip_cents, voided_at, received_by, appointments(origin, customers(name)), operator:profiles!appointment_payments_received_by_fk(full_name)";

export interface FechamentoBalcao {
  expectedCents: number;
  tipsCents: number;
  voidedCount: number;
  voidedCents: number;
  byOperator: Array<{
    operatorName: string | null;
    count: number;
    amountCents: number;
  }>;
  byMethod: Array<{ method: PaymentMethod; amountCents: number; count: number }>;
}

const FECHAMENTO_KEY = ["fechamento-balcao"] as const;

export function useFechamentoBalcao({
  from,
  to,
  onlyBalcao = false,
}: {
  from: string;
  to: string;
  onlyBalcao?: boolean;
}) {
  const { data: tenant } = useTenant();
  const timeZone = tenant?.timezone;
  const { canViewFinancials } = usePermissions();
  const { payments } = useSegmentFeatures();

  return useQuery<FechamentoBalcao>({
    queryKey: [...FECHAMENTO_KEY, { from, to, onlyBalcao }],
    enabled: !!timeZone && canViewFinancials && payments === true,
    queryFn: async () => {
      const tz = timeZone as string;
      const range = tenantRangeUtc(from, to, tz);
      if (!range) throw new Error("Período inválido.");

      let query = supabase
        .from("appointment_payments")
        .select(BALCAO_SELECT)
        .gte("received_at", range.startUtc.toISOString())
        .lt("received_at", range.endUtc.toISOString())
        .order("received_at", { ascending: true })
        .range(0, ROW_LIMIT - 1);
      if (onlyBalcao) query = query.eq("appointments.origin", "walk_in");

      const { data, error } = await query;
      if (error) throw error;

      const rows = z.array(balcaoRowSchema).parse(data ?? []);
      const active = rows.filter((row) => row.voided_at === null);
      const voided = rows.filter((row) => row.voided_at !== null);

      const operatorMap = new Map<string, { operatorName: string | null; count: number; amountCents: number }>();
      for (const row of active) {
        const key = row.received_by ?? "sem-operador";
        const current = operatorMap.get(key) ?? {
          operatorName: row.operator?.full_name ?? null,
          count: 0,
          amountCents: 0,
        };
        current.count += 1;
        current.amountCents += row.amount_cents;
        operatorMap.set(key, current);
      }

      return {
        expectedCents: active.reduce((sum, row) => sum + row.amount_cents, 0),
        tipsCents: active.reduce((sum, row) => sum + row.tip_cents, 0),
        voidedCount: voided.length,
        voidedCents: voided.reduce((sum, row) => sum + row.amount_cents, 0),
        byOperator: [...operatorMap.values()],
        byMethod: PAYMENT_METHODS.map((method) => {
          const methodRows = active.filter((row) => row.method === method);
          return {
            method,
            amountCents: methodRows.reduce((sum, row) => sum + row.amount_cents, 0),
            count: methodRows.length,
          };
        }),
      };
    },
  });
}
