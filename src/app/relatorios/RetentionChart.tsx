import { lazy, Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Gráfico de barras dos relatórios de retenção (ADR-17). Recharts carregado
 * por `lazy` (risco ADR-17: gráficos pesados) — o `Suspense` mostra Skeleton
 * e a tabela acessível irmã garante o conteúdo sem JS de gráfico.
 */

const LazyRateBarChart = lazy(() =>
  import("@/app/relatorios/RetentionRateChart").then((module) => ({
    default: module.RetentionRateChart,
  })),
);

export interface RateChartDatum {
  label: string;
  /** Fração 0–1 ou null (sem dados). */
  rate: number | null;
}

export function RetentionChart({
  data,
  ariaLabel,
  unit = "percent",
}: {
  data: RateChartDatum[];
  /** Rótulo acessível do gráfico (pt-BR). */
  ariaLabel: string;
  unit?: "percent" | "currency";
}) {
  return (
    <Suspense
      fallback={
        <div aria-busy="true" aria-label="Carregando gráfico">
          <Skeleton className="h-64 w-full" />
        </div>
      }
    >
      <LazyRateBarChart data={data} ariaLabel={ariaLabel} unit={unit} />
    </Suspense>
  );
}
