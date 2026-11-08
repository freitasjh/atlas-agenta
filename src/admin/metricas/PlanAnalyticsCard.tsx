import { StatePanel } from "@/components/StatePanel";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { getPlanLabel } from "@/lib/subscription-status";
import { PLAN_SLUGS, type PlanSlug } from "@/lib/plans";
import {
  formatRate,
  usePlanChurn,
  useTrialConversion,
  type PlanChurn,
  type TrialConversion,
} from "@/hooks/usePlanTelemetry";

function isKnownPlan(value: string): value is PlanSlug {
  return (PLAN_SLUGS as readonly string[]).includes(value);
}

function planName(plan: string): string {
  return isKnownPlan(plan) ? getPlanLabel(plan) : plan;
}

export interface PlanAnalyticsCardViewProps {
  conversion: TrialConversion | null;
  churn: PlanChurn | null;
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
}

/**
 * Card 2 (Arquétipo A — Métricas): conversão trial→ativo + churn por plano.
 * Denominador 0 → "—" + apoio, nunca 0%/NaN.
 */
export function PlanAnalyticsCardView({
  conversion,
  churn,
  isLoading,
  isError,
  onRetry,
}: PlanAnalyticsCardViewProps) {
  if (isLoading) {
    return (
      <div className="grid gap-3 sm:grid-cols-2" aria-busy="true">
        <Card>
          <CardContent className="space-y-2 p-5">
            <Skeleton className="h-5 w-44" />
            <Skeleton className="h-9 w-24" />
            <Skeleton className="h-4 w-full" />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="space-y-2 p-5">
            <Skeleton className="h-5 w-44" />
            <Skeleton className="h-9 w-24" />
            <Skeleton className="h-4 w-full" />
          </CardContent>
        </Card>
      </div>
    );
  }

  if (isError) {
    return (
      <StatePanel
        titulo="Não foi possível carregar conversão e churn"
        descricao="Verifique a conexão e tente novamente."
      >
        <div role="alert" className="sr-only">
          Erro ao carregar conversão e churn por plano
        </div>
        <Button variant="outline" onClick={onRetry}>
          Tentar novamente
        </Button>
      </StatePanel>
    );
  }

  const churnEntries = Object.entries(churn?.by_plan ?? {}).sort(([a], [b]) =>
    a.localeCompare(b),
  );

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Card>
        <CardContent className="space-y-1 p-5">
          <p className="text-sm text-muted-foreground">Conversão trial → ativo</p>
          <p
            className="font-display text-3xl font-semibold tabular-nums"
            aria-live="polite"
            aria-label={
              conversion === null || conversion.coorte === 0
                ? "Conversão sem coorte"
                : `Conversão ${formatRate(conversion.taxa)}`
            }
          >
            {conversion === null || conversion.coorte === 0 ? "—" : formatRate(conversion.taxa)}
          </p>
          <p className="text-xs text-muted-foreground" aria-live="polite">
            {conversion === null || conversion.coorte === 0
              ? "Sem coorte no período"
              : `${conversion.convertidos} de ${conversion.coorte} trials convertidos`}
          </p>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="space-y-1 p-5">
          <p className="text-sm text-muted-foreground">Churn por plano</p>
          {churnEntries.length === 0 ? (
            <>
              <p className="font-display text-3xl font-semibold tabular-nums" aria-live="polite">
                —
              </p>
              <p className="text-xs text-muted-foreground">Sem base no mês</p>
            </>
          ) : (
            <ul className="space-y-1" aria-live="polite">
              {churnEntries.map(([plan, entry]) => (
                <li
                  key={plan}
                  className="flex items-baseline justify-between gap-2 text-sm"
                >
                  <span>{planName(plan)}</span>
                  <span className="tabular-nums">
                    {entry.base === 0 ? (
                      "—"
                    ) : (
                      <>
                        {formatRate(entry.taxa)}{" "}
                        <span className="text-xs text-muted-foreground">
                          ({entry.churned} de {entry.base})
                        </span>
                      </>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export interface PlanAnalyticsCardProps {
  month: string;
  start: string;
  end: string;
  plan: PlanSlug | "todos";
}

function monthRange(month: string): { start: string; end: string } {
  const [y, m] = month.split("-").map(Number);
  if (!Number.isInteger(y) || !Number.isInteger(m) || m < 1 || m > 12) {
    return { start: `${month}-01`, end: `${month}-28` };
  }
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const mm = String(m).padStart(2, "0");
  return { start: `${y}-${mm}-01`, end: `${y}-${mm}-${String(lastDay).padStart(2, "0")}` };
}

export function PlanAnalyticsCard(props: PlanAnalyticsCardProps) {
  const range = monthRange(props.month);
  const start = props.start || range.start;
  const end = props.end || range.end;
  const conversionQuery = useTrialConversion({ start, end, plan: props.plan });
  const churnQuery = usePlanChurn(props.month);
  return (
    <PlanAnalyticsCardView
      conversion={conversionQuery.data ?? null}
      churn={churnQuery.data ?? null}
      isLoading={conversionQuery.isLoading || churnQuery.isLoading}
      isError={conversionQuery.isError || churnQuery.isError}
      onRetry={() => {
        void conversionQuery.refetch();
        void churnQuery.refetch();
      }}
    />
  );
}

export { monthRange };
