import { cn } from "@/lib/utils";
import { formatCentsToBRL } from "@/lib/money";

/**
 * Exibição de leitura do valor de comissão apurado (ADR-05, Fase 1b).
 * Centraliza a formatação para que a agenda (ADR-07) e o relatório (ADR-08)
 * falem a mesma língua: rótulo "Comissão", valor em BRL a partir de
 * `commissionCents` (snapshot já gravado no servidor), em `tabular-nums` para
 * alinhar colunas numéricas.
 *
 * Componente puro de apresentação: **sem estado de servidor próprio**. O gating
 * de segmento (`useSegmentFeatures`) e o de RBAC (`canViewCommission`) ficam a
 * cargo de quem renderiza — a trava real de leitura é o RLS no banco. Quando
 * `commissionCents` é `null`/`undefined` (atendimento sem comissão apurada),
 * não renderiza nada.
 */
export function CommissionAmount({
  commissionCents,
  className,
  label = "Comissão",
}: {
  /** Valor da comissão em centavos inteiros; `null`/`undefined` → não renderiza. */
  commissionCents: number | null | undefined;
  className?: string;
  /** Rótulo exibido antes do valor. Padrão "Comissão". */
  label?: string;
}) {
  if (commissionCents == null) {
    return null;
  }

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-sm text-muted-foreground",
        className,
      )}
    >
      <span>{label}</span>
      <span className="font-medium tabular-nums text-foreground">
        {formatCentsToBRL(commissionCents)}
      </span>
    </span>
  );
}
