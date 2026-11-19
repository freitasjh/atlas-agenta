import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";

import { supabase } from "@/lib/supabase";
import {
  campaignMetricsSchema,
  campaignPreviewSchema,
  campaignSchema,
  type Campaign,
  type CampaignMetrics,
  type CampaignPreview,
  type CampaignSegment,
} from "@/app/campanhas/model";

/**
 * Hooks de dados de campanhas (Fase 4, ADR-14 sobre ADR-05).
 *
 * Leituras sob RLS do tenant; escritas passam por INSERT/UPDATE direto
 * (RLS write admin) e envios pelos RPCs `SECURITY DEFINER`
 * (`campaign_preview_segment` só conta, `campaign_enqueue` marca
 * `excluded_opt_in`, `campaign_metrics` agrega). Tenant/papel derivados do
 * JWT no banco, nunca do cliente.
 *
 * Todas as queries recebem `enabled` — sem entitlement `campanhas` a página
 * nem dispara request sensível (gating RF-16).
 */

const CAMPAIGNS_KEY = ["campaigns", "list"] as const;

const CAMPAIGN_COLUMNS =
  "id, tenant_id, name, preset, template_id, segment, scheduled_at, status, created_at";

const campaignListSchema = z.array(campaignSchema);

async function fetchCampaigns(): Promise<Campaign[]> {
  const { data, error } = await supabase
    .from("campaigns")
    .select(CAMPAIGN_COLUMNS)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return campaignListSchema.parse(data);
}

export function useCampaigns(options?: { enabled?: boolean }) {
  const enabled = options?.enabled ?? true;
  return useQuery<Campaign[]>({
    queryKey: CAMPAIGNS_KEY,
    queryFn: fetchCampaigns,
    enabled,
  });
}

export interface SaveCampaignInput {
  id?: string;
  name: string;
  preset: Campaign["preset"];
  template_id: string | null;
  segment: CampaignSegment;
  scheduled_at: string | null;
  status: "rascunho" | "agendada";
}

async function saveCampaignRow(input: SaveCampaignInput): Promise<Campaign> {
  const payload = {
    name: input.name,
    preset: input.preset,
    template_id: input.template_id,
    segment: input.segment,
    scheduled_at: input.scheduled_at,
    status: input.status,
  };
  if (input.id) {
    const { data, error } = await supabase
      .from("campaigns")
      .update(payload)
      .eq("id", input.id)
      .select(CAMPAIGN_COLUMNS)
      .single();
    if (error) throw error;
    return campaignSchema.parse(data);
  }
  const { data, error } = await supabase
    .from("campaigns")
    .insert(payload)
    .select(CAMPAIGN_COLUMNS)
    .single();
  if (error) throw error;
  return campaignSchema.parse(data);
}

/** Criação/edição de rascunho ou agendamento (RF-13). */
export function useSaveCampaign() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: saveCampaignRow,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: CAMPAIGNS_KEY });
    },
  });
}

const previewResponseSchema = campaignPreviewSchema;

export function useCampaignPreview(
  campaignId: string | null,
  options?: { enabled?: boolean },
) {
  const enabled = (options?.enabled ?? true) && campaignId !== null;
  return useQuery<CampaignPreview>({
    queryKey: ["campaigns", "preview", campaignId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("campaign_preview_segment", {
        p_campaign_id: campaignId,
      });
      if (error) throw error;
      return previewResponseSchema.parse(data);
    },
    enabled,
  });
}

export function useCampaignMetrics(
  campaignId: string | null,
  options?: { enabled?: boolean },
) {
  const enabled = (options?.enabled ?? true) && campaignId !== null;
  return useQuery<CampaignMetrics>({
    queryKey: ["campaigns", "metrics", campaignId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("campaign_metrics", {
        p_campaign_id: campaignId,
      });
      if (error) throw error;
      return campaignMetricsSchema.parse(data);
    },
    enabled,
  });
}

const enqueueResponseSchema = z.object({
  queued: z.number().optional(),
  excluded_opt_in: z.number().optional(),
  replayed: z.boolean().optional(),
});

/**
 * Enfileira envios (RF-14/RF-15): cria `queued` só para `whatsapp_opt_in=true`,
 * demais viram `excluded_opt_in`. Idempotente por replay no banco.
 */
export function useEnqueueCampaign() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (campaignId: string) => {
      const { data, error } = await supabase.rpc("campaign_enqueue", {
        p_campaign_id: campaignId,
      });
      if (error) throw error;
      return enqueueResponseSchema.parse(data);
    },
    onSuccess: (_data, campaignId) => {
      void queryClient.invalidateQueries({ queryKey: CAMPAIGNS_KEY });
      void queryClient.invalidateQueries({ queryKey: ["campaigns", "metrics", campaignId] });
    },
  });
}
