import { z } from "zod";

export const CAMPAIGN_PRESETS = ["win_back", "birthday", "rebooking", "custom"] as const;
export type CampaignPreset = (typeof CAMPAIGN_PRESETS)[number];

export const CAMPAIGN_STATUSES = [
  "rascunho",
  "agendada",
  "enviando",
  "concluída",
  "cancelada",
] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];

export const CAMPAIGN_SEND_STATUSES = [
  "queued",
  "sent",
  "delivered",
  "read",
  "replied",
  "converted",
  "failed",
  "excluded_opt_in",
] as const;

/** Segmentação (espelha `campaign_customer_matches` do backend ADR-05). */
export const campaignSegmentSchema = z.object({
  tags: z.array(z.string()).optional(),
  last_visit_before_days: z.number().int().min(0).max(730).optional(),
  no_show_min: z.number().int().min(0).max(100).optional(),
  service_ids: z.array(z.string().uuid()).optional(),
  birthday_month: z.number().int().min(1).max(12).optional(),
});

export type CampaignSegment = z.infer<typeof campaignSegmentSchema>;

export const campaignSchema = z.object({
  id: z.string(),
  tenant_id: z.string(),
  name: z.string(),
  preset: z.enum(CAMPAIGN_PRESETS),
  template_id: z.string().nullable(),
  segment: campaignSegmentSchema.catch({}),
  scheduled_at: z.string().nullable(),
  status: z.enum(CAMPAIGN_STATUSES),
  created_at: z.string(),
});

export type Campaign = z.infer<typeof campaignSchema>;

export const campaignPreviewSchema = z.object({
  campaign_id: z.string(),
  total: z.number(),
  eligible: z.number(),
  excluded_opt_in: z.number(),
});

export type CampaignPreview = z.infer<typeof campaignPreviewSchema>;

export const campaignMetricsSchema = z.object({
  campaign_id: z.string(),
  counts: z.record(z.string(), z.number()),
});

export type CampaignMetrics = z.infer<typeof campaignMetricsSchema>;

export const campaignFormSchema = z.object({
  name: z.string().min(2, "O nome da campanha deve ter ao menos 2 caracteres."),
  preset: z.enum(CAMPAIGN_PRESETS),
  template_id: z.string().uuid("Escolha um modelo da biblioteca.").nullable(),
  scheduled_at: z.string().nullable(),
  tags: z.string().optional(),
  last_visit_before_days: z.string().optional(),
  no_show_min: z.string().optional(),
  birthday_month: z.string().optional(),
});

export type CampaignFormValues = z.infer<typeof campaignFormSchema>;

const POSITIVE_INT = /^\d+$/;

export function formToSegment(values: Pick<CampaignFormValues, "tags" | "last_visit_before_days" | "no_show_min" | "birthday_month">): CampaignSegment {
  const segment: CampaignSegment = {};
  const tags = (values.tags ?? "")
    .split(",")
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
  if (tags.length > 0) segment.tags = tags;
  if (values.last_visit_before_days && POSITIVE_INT.test(values.last_visit_before_days)) {
    segment.last_visit_before_days = Number(values.last_visit_before_days);
  }
  if (values.no_show_min && POSITIVE_INT.test(values.no_show_min)) {
    segment.no_show_min = Number(values.no_show_min);
  }
  if (values.birthday_month && POSITIVE_INT.test(values.birthday_month)) {
    const month = Number(values.birthday_month);
    if (month >= 1 && month <= 12) segment.birthday_month = month;
  }
  return segment;
}

export function presetLabel(preset: CampaignPreset): string {
  switch (preset) {
    case "win_back":
      return "Win-back";
    case "birthday":
      return "Aniversário";
    case "rebooking":
      return "Rebooking";
    case "custom":
      return "Personalizada";
  }
}

export function statusLabel(status: CampaignStatus): string {
  switch (status) {
    case "rascunho":
      return "Rascunho";
    case "agendada":
      return "Agendada";
    case "enviando":
      return "Enviando";
    case "concluída":
      return "Concluída";
    case "cancelada":
      return "Cancelada";
  }
}

/** Contagem segura de uma métrica (ausente = 0, nunca NaN). */
export function metricCount(metrics: CampaignMetrics | null | undefined, key: string): number {
  const value = metrics?.counts[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
