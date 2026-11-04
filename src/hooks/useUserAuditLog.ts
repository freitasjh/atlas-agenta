import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { z } from "zod";

import { supabase } from "@/lib/supabase";
import { auditLogListSchema, type AuditLogEntry } from "@/hooks/useAuditLog";

/**
 * Ações de auditoria ligadas a usuários do tenant (ADR-006, emitidas por
 * ADR-002). Leitura sob RLS: o tenant vem da política, nunca de filtro do
 * cliente — nenhum `.eq("tenant_id", …)` aqui.
 */
export const USER_AUDIT_ACTIONS = [
  "invitation.created",
  "invitation.accepted",
  "invitation.revoked",
  "invitation.resent",
  "user.role_changed",
  "user.deactivated",
  "user.reactivated",
  "professional.linked",
  "professional.unlinked",
] as const;

export type UserAuditAction = (typeof USER_AUDIT_ACTIONS)[number];

export const USER_AUDIT_LOG_KEY = ["user-audit-log"] as const;

const USER_AUDIT_LOG_SELECT =
  "id, tenant_id, actor_id, action, target_type, target_id, metadata, created_at";

export interface UserAuditLogFilters {
  action?: string | null;
  actor?: string | null;
  from?: string | null;
  to?: string | null;
}

export type UserAuditLogEntry = AuditLogEntry;

export const userAuditLogEntrySchema = z.object({
  id: z.string(),
  tenant_id: z.string().nullable(),
  actor_id: z.string().nullable(),
  action: z.string(),
  target_type: z.string().nullable(),
  target_id: z.string().nullable(),
  metadata: z.record(z.unknown()).default({}),
  created_at: z.string(),
});

function normalize(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

export function filterUserAuditLog(
  entries: UserAuditLogEntry[],
  filters?: UserAuditLogFilters | null,
): UserAuditLogEntry[] {
  const action = normalize(filters?.action) ?? "todas";
  const actor = normalize(filters?.actor)?.toLowerCase() ?? null;

  return entries.filter((entry) => {
    if (action !== "todas" && entry.action !== action) return false;
    if (actor && !(entry.actor_id ?? "").toLowerCase().includes(actor)) {
      return false;
    }
    return true;
  });
}

/**
 * Query de `audit_log` restrita a ações de usuário (filtro server-side via
 * `.in`, sob RLS). Período vai server-side (`.gte`/`.lte` em `created_at`) e
 * entra na `queryKey`; ator continua client-side em memória. Limite de 500
 * linhas (mais recentes primeiro). Resposta validada por zod (dado não
 * confiável).
 */
export function useUserAuditLog(filters?: UserAuditLogFilters | null) {
  const normalized: UserAuditLogFilters = useMemo(
    () => ({
      action: normalize(filters?.action) ?? "todas",
      actor: normalize(filters?.actor),
      from: normalize(filters?.from),
      to: normalize(filters?.to),
    }),
    [filters?.action, filters?.actor, filters?.from, filters?.to],
  );

  const query = useQuery<UserAuditLogEntry[]>({
    queryKey: [...USER_AUDIT_LOG_KEY, normalized.from ?? null, normalized.to ?? null],
    staleTime: 30_000,
    queryFn: async () => {
      // biome-ignore lint/suspicious/noExplicitAny: cadeia dinâmica do query builder (gte/lte condicionais).
      let builder: any = supabase
        .from("audit_log")
        .select(USER_AUDIT_LOG_SELECT)
        .in("action", [...USER_AUDIT_ACTIONS]);
      if (normalized.from) builder = builder.gte("created_at", normalized.from);
      if (normalized.to) builder = builder.lte("created_at", normalized.to);
      const { data, error } = await builder
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      return auditLogListSchema.parse(data ?? []);
    },
  });

  const filtered = useMemo(
    () => (query.data ? filterUserAuditLog(query.data, normalized) : undefined),
    [query.data, normalized],
  );

  return {
    ...query,
    data: filtered,
    unfiltered: query.data,
  };
}
