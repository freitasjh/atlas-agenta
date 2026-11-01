import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { z } from "zod";

import { supabase } from "@/lib/supabase";

/**
 * Hooks de dados de `audit_log` (ADR-17) — trilha de auditoria (somente leitura).
 *
 * Leitura sob RLS (super admin vê ações com `tenant_id is null`; admin do tenant
 * vê todas do próprio tenant). Nenhuma query filtra por `tenant_id` (`.eq`) — a
 * trava é a política RLS. Filtros (ação, ator, período) são **client-side** e
 * não entram na `queryKey` (a query busca tudo e o filtro ocorre em memória).
 *
 * Toda resposta é dado não confiável e validada por zod antes do uso.
 */

export const AUDIT_ACTIONS = [] as const;

export const auditLogRowSchema = z.object({
  id: z.string(),
  tenant_id: z.string().nullable(),
  actor_id: z.string().nullable(),
  action: z.string(),
  target_type: z.string().nullable(),
  target_id: z.string().nullable(),
  metadata: z.record(z.unknown()).default({}),
  created_at: z.string(),
});

export const auditLogSchema = auditLogRowSchema;
export const auditLogListSchema = z.array(auditLogRowSchema);

export type AuditLogEntry = z.infer<typeof auditLogRowSchema>;
export type AuditLog = AuditLogEntry;

export const AUDIT_LOG_KEY = ["audit-log"] as const;

const AUDIT_LOG_SELECT =
  "id, tenant_id, actor_id, action, target_type, target_id, metadata, created_at";

export interface AuditLogFilters {
  action?: string | null;
  acao?: string | null;
  actor?: string | null;
  actorId?: string | null;
  ator?: string | null;
  from?: string | null;
  to?: string | null;
  start?: string | null;
  end?: string | null;
  periodStart?: string | null;
  periodEnd?: string | null;
  period?:
    | { from?: string | null; to?: string | null; start?: string | null; end?: string | null }
    | [string | null, string | null]
    | string
    | null;
  [key: string]: unknown;
}

function pickString(...values: unknown[]): string | null {
  for (const v of values) {
    if (typeof v === "string" && v.trim() !== "") return v;
  }
  return null;
}

function normalizePeriod(filters: AuditLogFilters | null | undefined): {
  action: string;
  actor: string | null;
  from: string | null;
  to: string | null;
} {
  const f = filters ?? {};
  const action =
    pickString(f.action, f.acao, f.actionFilter, f.filterAction) ?? "todos";
  const actor = pickString(
    f.actor,
    f.actorId,
    f.ator,
    f.actor_id,
    f.filterActor,
  );

  let from: string | null = pickString(
    f.from,
    f.start,
    f.periodStart,
    f.dateFrom,
    f.fromDate,
  );
  let to: string | null = pickString(
    f.to,
    f.end,
    f.periodEnd,
    f.dateTo,
    f.toDate,
  );

  const period = f.period;
  if (Array.isArray(period)) {
    if (from === null) from = pickString(period[0]);
    if (to === null) to = pickString(period[1]);
  } else if (period && typeof period === "object") {
    if (from === null)
      from = pickString(
        (period as { from?: string | null }).from,
        (period as { start?: string | null }).start,
      );
    if (to === null)
      to = pickString(
        (period as { to?: string | null }).to,
        (period as { end?: string | null }).end,
      );
  } else if (typeof period === "string" && period.includes("..")) {
    const [a, b] = period.split("..");
    if (from === null) from = pickString(a);
    if (to === null) to = pickString(b);
  }

  return { action, actor, from, to };
}

export function filterAuditLog(
  entries: AuditLogEntry[],
  filters?: AuditLogFilters | null,
): AuditLogEntry[] {
  const { action, actor, from, to } = normalizePeriod(filters ?? undefined);
  const fromTime = from ? new Date(from).getTime() : NaN;
  const toTime = to ? new Date(to).getTime() : NaN;

  return entries.filter((entry) => {
    if (action && action !== "todos" && action !== "all" && entry.action !== action) {
      return false;
    }
    if (actor && actor !== "todos" && actor !== "all" && actor !== "null" && entry.actor_id !== actor) {
      return false;
    }
    const created = new Date(entry.created_at).getTime();
    if (!Number.isNaN(fromTime) && created < fromTime) return false;
    if (!Number.isNaN(toTime) && created > toTime) return false;
    return true;
  });
}

/** Aliases para variantes de nomenclatura. */
export const filterAuditLogs = filterAuditLog;
export const filterAuditEntries = filterAuditLog;
export const filterAuditLogEntries = filterAuditLog;

/**
 * Query de `audit_log` (leitura sob RLS). Filtros aplicados client-side em
 * memória; não alteram a `queryKey`.
 */
export function useAuditLog(filters?: AuditLogFilters | null) {
  const query = useQuery<AuditLogEntry[]>({
    queryKey: AUDIT_LOG_KEY,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("audit_log")
        .select(AUDIT_LOG_SELECT)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return auditLogListSchema.parse(data ?? []);
    },
  });

  const filtered = useMemo(
    () => (query.data ? filterAuditLog(query.data, filters ?? undefined) : undefined),
    [query.data, filters],
  );

  const allActions = useMemo(
    () => Array.from(new Set((query.data ?? []).map((e) => e.action))).sort(),
    [query.data],
  );

  return {
    ...query,
    data: filtered,
    rawData: query.data,
    allData: query.data,
    raw: query.data,
    unfiltered: query.data,
    allActions,
  };
}
