import { Card, CardContent } from "@/components/ui/card";

import type { DashboardOverviewBucket } from "@/hooks/useDashboardSummary";
import { DeltaBadge } from "@/app/dashboard/DeltaBadge";
import { formatCount, formatRate, formatRateDelta } from "@/app/dashboard/format";

/**
 * Métrica-herói do painel: a taxa de no-show enquadrada como **saúde da
 * operação**, não troféu (analysis-frontend §2.2). Número grande em
 * `font-display`/`tabular-nums` usando `--foreground` (contraste máximo, nunca
 * o jade como texto), **denominador bruto em texto** ("X faltas em Y
 * agendamentos do período") e um `DeltaBadge` cuja direção é semântica: queda
 * de no-show = melhora (`melhorQuando="cai"`).
 *
 * Denominador 0 → "—" + "Sem agendamentos para calcular", nunca "0%"/"NaN"
 * (RF-DASH-01, AC-10). O grupo tem `aria-label` em pt-BR que lê número +
 * denominador + comparação para o leitor de tela.
 */

interface HeroNoShowCardProps {
  current: DashboardOverviewBucket;
  previous: DashboardOverviewBucket;
}

/** Monta o `aria-label` completo (número + denominador + comparação). */
function buildAriaLabel(
  current: DashboardOverviewBucket,
  previous: DashboardOverviewBucket,
): string {
  if (current.no_show_rate === null) {
    return "Taxa de não comparecimento: sem agendamentos no período para calcular.";
  }
  const taxa = formatRate(current.no_show_rate);
  const denom = `${formatCount(current.nao_compareceu)} ${
    current.nao_compareceu === 1 ? "falta" : "faltas"
  } em ${formatCount(current.total_agendados)} ${
    current.total_agendados === 1 ? "agendamento" : "agendamentos"
  } do período`;

  if (previous.no_show_rate === null) {
    return `Taxa de não comparecimento: ${taxa}, ${denom}. Sem período anterior para comparar.`;
  }
  const delta = current.no_show_rate - previous.no_show_rate;
  if (delta === 0) {
    return `Taxa de não comparecimento: ${taxa}, ${denom}. Estável em relação ao período anterior.`;
  }
  const direcao = delta < 0 ? "a menos" : "a mais";
  const sentido = delta < 0 ? "uma melhora" : "uma piora";
  return `Taxa de não comparecimento: ${taxa}, ${denom}. ${formatRateDelta(Math.abs(delta))} ${direcao} que o período anterior, ${sentido}.`;
}

export function HeroNoShowCard({ current, previous }: HeroNoShowCardProps) {
  const temDados = current.no_show_rate !== null;

  return (
    <Card
      aria-label={buildAriaLabel(current, previous)}
      role="group"
      className="h-full"
    >
      <CardContent className="flex h-full flex-col justify-between gap-6 p-6">
        <div className="space-y-1">
          <p className="text-sm font-medium text-muted-foreground">
            Taxa de não comparecimento
          </p>
          <p className="text-xs text-muted-foreground">
            Saúde da operação no período
          </p>
        </div>

        <div className="space-y-3" aria-hidden="true">
          <p className="font-display text-5xl font-semibold tabular-nums tracking-tight text-foreground sm:text-6xl">
            {formatRate(current.no_show_rate)}
          </p>
          {temDados ? (
            <p className="text-sm text-muted-foreground">
              {formatCount(current.nao_compareceu)}{" "}
              {current.nao_compareceu === 1 ? "falta" : "faltas"} em{" "}
              {formatCount(current.total_agendados)}{" "}
              {current.total_agendados === 1
                ? "agendamento"
                : "agendamentos"}{" "}
              do período
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">
              Sem agendamentos para calcular
            </p>
          )}
        </div>

        {temDados ? (
          <div aria-hidden="true">
            <DeltaBadge
              atual={current.no_show_rate ?? 0}
              anterior={previous.no_show_rate}
              melhorQuando="cai"
              formatarMagnitude={formatRateDelta}
            />
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
