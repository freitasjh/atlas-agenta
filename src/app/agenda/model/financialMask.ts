import type { Role } from "@/types/domain";
import type { DaySummary } from "@/app/agenda/model/daySummary";

/**
 * Máscara financeira RBAC (ADR-01, R2).
 *
 * `receptionist` não vê valores R$ (cards sem R$); `admin`, `super_admin` e
 * `professional` veem (professional só consome a própria agenda — filtro que
 * pertence à query, não a esta máscara). Centraliza a regra para reuso nas
 * telas da série (ResumoDoDia, Dia, Semana, Drawer).
 */
export function canSeeFinancials(role: Role): boolean {
  return role !== "receptionist";
}

/** Retorna `null` para `receptionist`, o valor intacto para os demais papéis. */
export function maskFinancials<T>(role: Role, value: T): T | null {
  return canSeeFinancials(role) ? value : null;
}

export type MaskedDaySummary = Omit<DaySummary, "previstoCents"> & {
  previstoCents: number | null;
};

/** Aplica a máscara RBAC ao resumo sem mutar o objeto original. */
export function maskDaySummaryForRole(
  summary: DaySummary,
  role: Role,
): MaskedDaySummary {
  return {
    ...summary,
    previstoCents: maskFinancials(role, summary.previstoCents),
  };
}
