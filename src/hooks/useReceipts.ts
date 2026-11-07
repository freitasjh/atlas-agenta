import { useQuery } from "@tanstack/react-query";
import { z } from "zod";

import { supabase } from "@/lib/supabase";
import { tenantRangeUtc } from "@/lib/datetime";
import { useTenant } from "@/hooks/useTenant";
import { usePermissions } from "@/hooks/usePermissions";
import { useSegmentFeatures } from "@/hooks/useSegmentFeatures";
import { PAYMENT_METHODS, type ReceivableRow } from "@/types/payments";

/**
 * Aba Recebimentos (ADR-005 §3): leitura direta do ledger sob RLS admin, sem
 * Edge de lista. Embed de cliente/operador numa request só (sem N+1).
 * Paginação server-side de 25, `received_at desc`.
 *
 * Gating idêntico ao painel: `enabled` só com fuso + `canViewFinancials` +
 * `payments === true`. Recepção/profissional nunca disparam (a trava real é
 * a RLS admin-only de `appointment_payments`, ADR-001).
 */

export const RECEIPT_PAGE_SIZE = 25;

export type ReceiptMethodFilter = "todos" | (typeof PAYMENT_METHODS)[number];
export type ReceiptStatusFilter = "todos" | "ativos" | "estornados";

const receiptRowSchema = z
  .object({
    id: z.string(),
    received_at: z.string(),
    method: z.enum(PAYMENT_METHODS),
    amount_cents: z.number().int(),
    tip_cents: z.number().int(),
    source: z.enum(["manual", "asaas"]),
    received_by: z.string().nullable(),
    voided_at: z.string().nullable(),
    void_reason: z.string().nullable(),
    charge_id: z.string().nullable(),
    appointments: z
      .object({ customers: z.object({ name: z.string() }).nullable() })
      .nullable(),
    operator: z.object({ full_name: z.string() }).nullable(),
  })
  .passthrough();

const RECEIPTS_KEY = ["receipts"] as const;

const RECEIPTS_SELECT =
  "id, received_at, method, amount_cents, tip_cents, source, received_by, voided_at, void_reason, charge_id, appointments(customer_id, customers(name)), operator:profiles!appointment_payments_received_by_fk(full_name)";

export interface ReceiptsResult {
  rows: ReceivableRow[];
  total: number;
}

export function useReceipts({
  /** `YYYY-MM-DD` de início (inclusivo) no fuso do tenant. */
  from,
  /** `YYYY-MM-DD` de fim (inclusivo) no fuso do tenant. */
  to,
  method = "todos",
  situacao = "todos",
  /** 0-based; página de 25. */
  page = 0,
}: {
  from: string;
  to: string;
  method?: ReceiptMethodFilter;
  situacao?: ReceiptStatusFilter;
  page?: number;
}) {
  const { data: tenant } = useTenant();
  const timeZone = tenant?.timezone;

  const { canViewFinancials } = usePermissions();
  const { payments } = useSegmentFeatures();

  return useQuery<ReceiptsResult>({
    queryKey: [...RECEIPTS_KEY, { from, to, method, situacao, page }],
    enabled: !!timeZone && canViewFinancials && payments === true,
    queryFn: async () => {
      const tz = timeZone as string;
      const range = tenantRangeUtc(from, to, tz);
      if (!range) throw new Error("Período inválido.");

      let query = supabase
        .from("appointment_payments")
        .select(RECEIPTS_SELECT, { count: "exact" })
        .gte("received_at", range.startUtc.toISOString())
        .lt("received_at", range.endUtc.toISOString())
        .order("received_at", { ascending: false })
        .range(page * RECEIPT_PAGE_SIZE, page * RECEIPT_PAGE_SIZE + RECEIPT_PAGE_SIZE - 1);

      if (method !== "todos") query = query.eq("method", method);
      if (situacao === "ativos") query = query.is("voided_at", null);
      if (situacao === "estornados") query = query.not("voided_at", "is", null);

      const { data, error, count } = await query;
      if (error) throw error;

      const rows = z.array(receiptRowSchema).parse((data as { rows?: unknown }).rows ?? data);
      return {
        rows: rows.map(
          (row): ReceivableRow => ({
            id: row.id,
            received_at: row.received_at,
            customer_name: row.appointments?.customers?.name ?? null,
            method: row.method,
            amount_cents: row.amount_cents,
            tip_cents: row.tip_cents,
            source: row.source,
            operator_name: row.operator?.full_name ?? null,
            voided_at: row.voided_at,
            void_reason: row.void_reason,
            charge_id: row.charge_id,
          }),
        ),
        total: count ?? 0,
      };
    },
  });
}
