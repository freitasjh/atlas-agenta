import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useCampaignMetrics } from "@/hooks/useCampaigns";
import { metricCount, type Campaign } from "@/app/campanhas/model";
import { campanhasMessages } from "@/app/campanhas/campanhas-messages";

const t = campanhasMessages.metrics;

interface CampaignMetricsPanelProps {
  campaign: Campaign | null;
  entitled: boolean;
}

function MetricTile({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div
      role="group"
      aria-label={`${rotulo}: ${valor}`}
      className="rounded-lg border border-border p-3"
    >
      <p className="text-xs font-medium text-muted-foreground">{rotulo}</p>
      <p className="font-display text-2xl font-semibold tabular-nums tracking-tight text-foreground">
        {valor}
      </p>
    </div>
  );
}

/**
 * Métricas da campanha (RF-14): enviadas, entregues, lidas, respostas e
 * conversões via `campaign_metrics`. Sem envios, mostra estado vazio —
 * nunca `NaN`/`0%` falso.
 */
export function CampaignMetricsPanel({ campaign, entitled }: CampaignMetricsPanelProps) {
  const metricsQuery = useCampaignMetrics(campaign?.id ?? null, { enabled: entitled });
  const metrics = metricsQuery.data ?? null;

  if (!campaign) return null;

  const sent = metricCount(metrics, "sent");
  const delivered = metricCount(metrics, "delivered");
  const read = metricCount(metrics, "read");
  const replied = metricCount(metrics, "replied");
  const converted = metricCount(metrics, "converted");
  const failed = metricCount(metrics, "failed");
  const excluded = metricCount(metrics, "excluded_opt_in");
  const queued = metricCount(metrics, "queued");

  const hasSends = sent + delivered + read + replied + converted + failed + queued > 0;

  return (
    <Card aria-label={`Métricas de ${campaign.name}`}>
      <CardHeader>
        <CardTitle className="text-base">{t.title}</CardTitle>
      </CardHeader>
      <CardContent>
        {metricsQuery.isLoading ? (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3" aria-busy="true" aria-label={t.loading}>
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        ) : !hasSends ? (
          <p className="text-sm text-muted-foreground">{t.empty}</p>
        ) : (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              <MetricTile rotulo={t.sent} valor={String(sent)} />
              <MetricTile rotulo={t.delivered} valor={String(delivered)} />
              <MetricTile rotulo={t.read} valor={String(read)} />
              <MetricTile rotulo={t.replied} valor={String(replied)} />
              <MetricTile rotulo={t.converted} valor={String(converted)} />
              <MetricTile rotulo={t.failed} valor={String(failed)} />
            </div>
            <p className="text-xs tabular-nums text-muted-foreground">
              {t.queued}: {queued} · {t.excludedOptIn}: {excluded} · {t.conversionHint}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
