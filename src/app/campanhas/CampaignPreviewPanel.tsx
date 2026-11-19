import { useMemo } from "react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useCampaignPreview } from "@/hooks/useCampaigns";
import { useMessageTemplates } from "@/hooks/useMessageTemplates";
import type { Campaign } from "@/app/campanhas/model";
import { campanhasMessages } from "@/app/campanhas/campanhas-messages";

const t = campanhasMessages.preview;

interface CampaignPreviewPanelProps {
  campaign: Campaign | null;
  entitled: boolean;
}

/**
 * Prévia do público da campanha (RF-13/RF-15): contagem de elegíveis e
 * excluídos por opt-in via `campaign_preview_segment`, mais o texto do
 * modelo da biblioteca (reuso de TemplatesMensagemPage como fonte).
 */
export function CampaignPreviewPanel({ campaign, entitled }: CampaignPreviewPanelProps) {
  const previewQuery = useCampaignPreview(campaign?.id ?? null, { enabled: entitled });
  const templatesQuery = useMessageTemplates();

  const templateBody = useMemo(() => {
    if (!campaign?.template_id) return null;
    return templatesQuery.data?.find((row) => row.id === campaign.template_id)?.body ?? null;
  }, [campaign?.template_id, templatesQuery.data]);

  if (!campaign) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t.title}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">{t.empty}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card aria-label={`Prévia do público de ${campaign.name}`}>
      <CardHeader>
        <CardTitle className="text-base">{t.title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {previewQuery.isLoading ? (
          <div className="space-y-2" aria-busy="true" aria-label={t.loading}>
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        ) : previewQuery.isError || !previewQuery.data ? (
          <p role="alert" className="text-sm text-muted-foreground">
            {t.error}
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            <Badge variant="default">
              {t.eligible.replace("{count}", String(previewQuery.data.eligible))}
            </Badge>
            <Badge variant="outline">
              {t.excludedOptIn.replace("{count}", String(previewQuery.data.excluded_opt_in))}
            </Badge>
            <span className="w-full text-xs text-muted-foreground">
              {t.total.replace("{count}", String(previewQuery.data.total))} · {t.consentNote}
            </span>
          </div>
        )}

        {templateBody ? (
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground">{t.libraryNote}</p>
            <p className="whitespace-pre-wrap break-words rounded-md border border-border bg-muted/40 p-3 text-sm text-foreground">
              {templateBody}
            </p>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
