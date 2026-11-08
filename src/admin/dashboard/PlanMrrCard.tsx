import { TriangleAlert } from "lucide-react";

import { StatePanel } from "@/components/StatePanel";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { getPlanLabel } from "@/lib/subscription-status";
import { PLAN_SLUGS, type PlanSlug } from "@/lib/plans";
import { formatCentsToBRL } from "@/lib/money";
import {
  formatMrrCents,
  usePlanMrr,
  type PlanMrr,
} from "@/hooks/usePlanTelemetry";

function isKnownPlan(value: string): value is PlanSlug {
  return (PLAN_SLUGS as readonly string[]).includes(value);
}

export interface PlanMrrCardViewProps {
  mrr: PlanMrr | null;
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
  month: string;
}

/**
 * Card 1 (Arquétipo A — Dashboard): MRR + mix por plano + alerta de quota
 * com link âncora para a tabela quente. Somente leitura.
 */
export function PlanMrrCardView({ mrr, isLoading, isError, onRetry, month }: PlanMrrCardViewProps) {
  if (isLoading) {
    return (
      <Card>
        <CardContent className="space-y-2 p-5" aria-busy="true">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-9 w-32" />
          <Skeleton className="h-4 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (isError) {
    return (
      <StatePanel
        titulo="Não foi possível carregar a telemetria de planos"
        descricao="Verifique a conexão e tente novamente."
      >
        <div role="alert" className="sr-only">
          Erro ao carregar MRR de {month}
        </div>
        <Button variant="outline" onClick={onRetry}>
          Tentar novamente
        </Button>
      </StatePanel>
    );
  }

  const hasRevenue = mrr !== null && mrr.base_ativa > 0;
  const entries = Object.entries(mrr?.by_plan ?? {}).sort(([a], [b]) => a.localeCompare(b));

  return (
    <Card>
      <CardContent className="space-y-2 p-5">
        <p className="text-sm text-muted-foreground">Receita mensal (MRR)</p>
        <p
          className="font-display text-3xl font-semibold tabular-nums"
          aria-live="polite"
          aria-label={hasRevenue ? `MRR ${formatMrrCents(mrr?.mrr_cents)}` : "MRR sem pagantes"}
        >
          {hasRevenue ? formatCentsToBRL(mrr.mrr_cents) : "—"}
        </p>
        <p className="text-xs text-muted-foreground" aria-live="polite">
          {hasRevenue
            ? `${mrr.base_ativa} ${mrr.base_ativa === 1 ? "empresa pagante" : "empresas pagantes"} · ${entries
                .map(([plan, e]) =>
                  isKnownPlan(plan) ? `${e.base} ${getPlanLabel(plan)}` : `${e.base} ${plan}`,
                )
                .join(" · ")}`
            : "Sem pagantes"}
        </p>
        <p className="flex min-h-11 items-center gap-2 text-sm">
          <TriangleAlert className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <a href="#quota-quente" className="min-h-11 underline underline-offset-4">
            Ver empresas próximas do limite
          </a>
        </p>
      </CardContent>
    </Card>
  );
}

export function PlanMrrCard({ month }: { month: string }) {
  const query = usePlanMrr(month);
  return (
    <PlanMrrCardView
      mrr={query.data ?? null}
      isLoading={query.isLoading}
      isError={query.isError}
      onRetry={() => void query.refetch()}
      month={month}
    />
  );
}
