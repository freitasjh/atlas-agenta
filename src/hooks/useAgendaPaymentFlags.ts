import { useQuery } from "@tanstack/react-query";
import { z } from "zod";

import { supabase } from "@/lib/supabase";
import type { AppointmentStatus } from "@/types/domain";
import { PAYMENT_STATUSES, type PaymentStatus } from "@/types/payments";

/**
 * Flags de pagamento da agenda (ADR-004 §7 + adendo da ADR-002). Uma única
 * Edge (`get-agenda-payment-statuses`) devolve só o rótulo por atendimento —
 * sem valores, saldo, QR ou histórico — em lotes de até 200 ids.
 *
 * `unknown` = o ator não pode ver o estado (ex.: RLS/feature desligada) ou a
 * consulta ainda não resolveu. A UI nunca inventa selo a partir de `unknown`.
 */

export type AgendaPaymentFlag = PaymentStatus | "unknown";

export const MAX_AGENDA_FLAGS_BATCH = 200;

const responseSchema = z.object({
  statuses: z.array(
    z.object({
      appointment_id: z.string(),
      payment_status: z.enum(PAYMENT_STATUSES),
    }),
  ),
});

export interface AgendaPaymentFlagRow {
  id: string;
  price_cents: number;
  status: AppointmentStatus;
}

export interface AgendaPaymentFlags {
  statusById: ReadonlyMap<string, AgendaPaymentFlag>;
  pendingCount: number;
  isLoading: boolean;
  isError: boolean;
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    out.push(items.slice(index, index + size));
  }
  return out;
}

async function readStatuses(ids: string[]): Promise<Map<string, PaymentStatus>> {
  const batches = chunk(ids, MAX_AGENDA_FLAGS_BATCH);
  const results = await Promise.all(
    batches.map(async (batch) => {
      const { data, error } = await supabase.functions.invoke(
        "get-agenda-payment-statuses",
        { body: { appointment_ids: batch } },
      );
      if (error) throw error;
      const parsed = responseSchema.safeParse(data);
      if (!parsed.success) throw new Error("invalid agenda payment statuses");
      return parsed.data.statuses;
    }),
  );
  const map = new Map<string, PaymentStatus>();
  for (const statuses of results) {
    for (const row of statuses) {
      map.set(row.appointment_id, row.payment_status);
    }
  }
  return map;
}

export function useAgendaPaymentFlags(
  rows: ReadonlyArray<AgendaPaymentFlagRow>,
  options: { enabled?: boolean } = {},
): AgendaPaymentFlags {
  const enabled = options.enabled ?? true;
  const ids = Array.from(new Set(rows.map((row) => row.id))).sort();
  const canQuery = enabled && ids.length > 0;

  const query = useQuery({
    queryKey: ["agenda-payment-flags", ids],
    enabled: canQuery,
    queryFn: () => readStatuses(ids),
    staleTime: 30_000,
  });

  const statusById = new Map<string, AgendaPaymentFlag>();
  for (const row of rows) {
    let flag: AgendaPaymentFlag = "unknown";
    if (canQuery) {
      const remote = query.data?.get(row.id);
      if (remote) {
        flag = remote;
      } else if (row.price_cents === 0 && row.status === "concluido") {
        // Total zero é quitado pela precedência da ADR-002; não há o que pagar.
        flag = "quitado";
      }
    }
    statusById.set(row.id, flag);
  }

  let pendingCount = 0;
  // O selo "Pagamento pendente" só existe em atendimento **concluído**
  // (ADR-004 §5.3.1). Contar `em_atendimento`/`pendente` fazia o toggle
  // anunciar um número maior do que os selos visíveis.
  for (const row of rows) {
    if (row.status !== "concluido") continue;
    const flag = statusById.get(row.id);
    if (
      flag === "sem_pagamento" ||
      flag === "parcial" ||
      flag === "aguardando_pix"
    ) {
      pendingCount += 1;
    }
  }

  return {
    statusById,
    pendingCount,
    isLoading: canQuery && query.isLoading,
    isError: canQuery && query.isError,
  };
}
