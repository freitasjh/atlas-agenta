import { CircleAlert, TriangleAlert } from "lucide-react";

import { StatePanel } from "@/components/StatePanel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getPlanLabel } from "@/lib/subscription-status";
import { PLAN_SLUGS, type PlanSlug } from "@/lib/plans";
import {
  quotaRowRatio,
  sortQuotaHot,
  type QuotaHotRow,
} from "@/hooks/usePlanTelemetry";

function isKnownPlan(value: string): value is PlanSlug {
  return (PLAN_SLUGS as readonly string[]).includes(value);
}

export type QuotaStatus = "ok" | "warning" | "destructive";

export function quotaStatusOf(ratio: number | null): QuotaStatus {
  if (ratio === null) return "ok";
  if (ratio >= 0.95) return "destructive";
  if (ratio >= 0.8) return "warning";
  return "ok";
}

export interface QuotaHotTableProps {
  rows: QuotaHotRow[];
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
}

/**
 * Tabela quente (Empresa|Plano|Uso|%|Status): badge warning ≥80 / destructive
 * ≥95 com ícone+texto, ordenada % desc, LIMIT 100 no servidor. Scroll interno
 * (página sem scroll-x em 375px).
 */
export function QuotaHotTable({ rows, isLoading, isError, onRetry }: QuotaHotTableProps) {
  if (isLoading) {
    return (
      <div className="space-y-2" aria-busy="true">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  if (isError) {
    return (
      <StatePanel
        titulo="Não foi possível carregar a quota quente"
        descricao="Verifique a conexão e tente novamente."
      >
        <div role="alert" className="sr-only">
          Erro ao carregar empresas próximas do limite
        </div>
        <Button variant="outline" onClick={onRetry}>
          Tentar novamente
        </Button>
      </StatePanel>
    );
  }

  const sorted = sortQuotaHot(rows);

  return (
    <section id="quota-quente" aria-label="Empresas próximas do limite" className="space-y-2">
      <h2 className="text-lg font-semibold">Empresas próximas do limite</h2>
      {sorted.length === 0 ? (
        <StatePanel
          titulo="Nenhuma empresa próxima do limite"
          descricao="Nenhum tenant atingiu 80% de profissionais ou agendamentos."
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Empresa</TableHead>
                <TableHead>Plano</TableHead>
                <TableHead>Uso</TableHead>
                <TableHead>%</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sorted.map((rowItem) => {
                const ratio = quotaRowRatio(rowItem);
                const status = quotaStatusOf(ratio);
                return (
                  <TableRow key={rowItem.tenant_id}>
                    <TableCell>{rowItem.trade_name ?? rowItem.tenant_id}</TableCell>
                    <TableCell>
                      {isKnownPlan(rowItem.plan) ? getPlanLabel(rowItem.plan) : rowItem.plan}
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {rowItem.profs}/{rowItem.prof_limit ?? "—"} profs · {rowItem.appts}/
                      {rowItem.appt_limit ?? "—"} appts
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {ratio === null ? "—" : `${(ratio * 100).toFixed(0)}%`}
                    </TableCell>
                    <TableCell>
                      {status === "destructive" ? (
                        <Badge variant="destructive">
                          <CircleAlert className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
                          Crítico
                        </Badge>
                      ) : status === "warning" ? (
                        <Badge variant="outline">
                          <TriangleAlert className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
                          Atenção
                        </Badge>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </section>
  );
}
