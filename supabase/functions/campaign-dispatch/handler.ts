// Edge Function `campaign-dispatch` — DRENADORA da fila de envios de campanha
// (ADR-05 Fase 4, RF-14/RF-15/RF-16).
//
// Invocada pelo scheduler (cron via pg_net no hosted) ou manualmente (QA), sem JWT
// de usuário — mesmo padrão de `whatsapp-dispatch` e `expire-deposits`. Opera com
// service role (bypassa RLS) e aplica os gates no servidor, nesta ordem:
//
//   1. campanha existe e está em `enviando` (senão, nada a drenar);
//   2. entitlement `campanhas` no plano do tenant (lido de `plans.features`);
//   3. assinatura ativa (bloqueado/cancelado suspende o disparo);
//   4. janela de envio (hora local do tenant entre send_start_hour/end_hour);
//   5. template aprovado fora da janela de 24h quando `require_approved_template`;
//   6. instância WhatsApp conectada;
//   7. por envio: opt-in rechecdo (sem consentimento → `excluded_opt_in`),
//      teto de frequência (`max_per_customer_30d` em 30 dias) e envio via adapter.
//
// IDEMPOTÊNCIA: o claim é atômico na RPC `campaign_claim_sends` (FOR UPDATE
// SKIP LOCKED + marcador `claim:<uuid>`); duas invocações sobrepostas nunca pegam
// o mesmo envio. Claims travados voltam via `campaign_release_stale_claims`.
// PII mínima: telefone/texto nunca em log; `provider_message_id` de claim nunca
// sai como id real. Segredos só em env do servidor, nunca no bundle.

import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { createEvolutionAdapter, type EvolutionAdapter } from "../whatsapp/evolution-adapter.ts";
import { requestSchema } from "./schemas.ts";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const STALE_CLAIM_MINUTES = 15;

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

export interface ClaimedSend {
  send_id: string;
  tenant_id: string;
  customer_id: string;
}

export interface DispatchSummary {
  processed: number;
  sent: number;
  excluded_opt_in: number;
  frequency_capped: number;
  failed: number;
  completed: boolean;
}

/** Renderiza o corpo com {nome} e {empresa}. Pura: sem rede, sem banco. */
export function renderCampaignBody(
  body: string,
  customerName: string | null,
  companyName: string | null,
): string {
  return body
    .replaceAll("{nome}", (customerName ?? "").trim() || "cliente")
    .replaceAll("{empresa}", (companyName ?? "").trim() || "nossa equipe");
}

/** Hora local (0–23) do tenant para `now`. Pura. */
export function hourInTimezone(now: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("pt-BR", {
    hour: "numeric",
    hour12: false,
    timeZone,
  }).formatToParts(now);
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0") % 24;
  return hour;
}

/** Dentro da janela de envio? Janela cruzando a meia-noite é suportada. */
export function isWithinSendWindow(hour: number, startHour: number, endHour: number): boolean {
  if (startHour <= endHour) return hour >= startHour && hour < endHour;
  return hour >= startHour || hour < endHour;
}

export interface HandlerDeps {
  createService: () => SupabaseClient;
  createAdapter?: () => EvolutionAdapter;
  now?: () => Date;
}

interface CampaignRow {
  id: string;
  tenant_id: string;
  template_id: string | null;
  require_approved_template: boolean;
  send_start_hour: number;
  send_end_hour: number;
  max_per_customer_30d: number;
  status: string;
}

export function createHandler(deps: HandlerDeps) {
  return async (req: Request): Promise<Response> => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
    if (req.method !== "POST") return jsonResponse({ error: "method_not_allowed" }, 405);

    let service: SupabaseClient;
    try {
      service = deps.createService();
    } catch {
      return jsonResponse({ error: "internal_error" }, 500);
    }
    const now = deps.now ?? (() => new Date());

    let parsed: unknown;
    try {
      parsed = requestSchema.safeParse(await req.json());
    } catch {
      return jsonResponse({ error: "invalid_body" }, 400);
    }
    if (!(parsed as { success: boolean }).success) {
      return jsonResponse({ error: "invalid_body" }, 400);
    }
    const body = (parsed as { data: { campaign_id: string; limit: number } }).data;

    // 1. Campanha.
    const { data: campaign, error: campaignError } = await service
      .from("campaigns")
      .select(
        "id, tenant_id, template_id, require_approved_template, send_start_hour, send_end_hour, max_per_customer_30d, status",
      )
      .eq("id", body.campaign_id)
      .maybeSingle();
    if (campaignError || !campaign) {
      return jsonResponse({ error: "campaign_not_found" }, 404);
    }
    const row = campaign as unknown as CampaignRow;
    if (row.status !== "enviando") {
      return jsonResponse({ error: "campaign_not_running", status: row.status }, 409);
    }

    // 2. Tenant + entitlement + assinatura.
    const { data: tenant } = await service
      .from("tenants")
      .select("plan, subscription_status, timezone, trade_name, legal_name")
      .eq("id", row.tenant_id)
      .maybeSingle();
    const tenantRow = (tenant ?? {}) as Record<string, unknown>;
    const subStatus = tenantRow["subscription_status"] as string | null;
    if (subStatus === "bloqueado" || subStatus === "cancelado") {
      return jsonResponse({ error: "assinatura_suspensa" }, 409);
    }
    const { data: planRow } = await service
      .from("plans")
      .select("features")
      .eq("slug", (tenantRow["plan"] as string | null) ?? "")
      .maybeSingle();
    const features = (planRow as { features?: unknown } | null)?.features;
    if (!Array.isArray(features) || !features.includes("campanhas")) {
      return jsonResponse({ error: "feature_disabled" }, 403);
    }

    // 3. Template (fora da janela de 24h exige aprovado).
    const { data: template } = row.template_id
      ? await service
        .from("campaign_templates")
        .select("body, approved_outside_24h, active")
        .eq("tenant_id", row.tenant_id)
        .eq("id", row.template_id)
        .maybeSingle()
      : { data: null };
    const templateRow = template as
      | { body: string; approved_outside_24h: boolean; active: boolean }
      | null;
    if (!templateRow || templateRow.active === false) {
      return jsonResponse({ error: "invalid_template" }, 400);
    }
    if (row.require_approved_template && !templateRow.approved_outside_24h) {
      return jsonResponse({ error: "template_not_approved" }, 400);
    }

    // 4. Janela de envio (hora local do tenant).
    const timeZone = ((tenantRow["timezone"] as string | null) ?? "").trim() ||
      "America/Sao_Paulo";
    const hour = hourInTimezone(now(), timeZone);
    if (!isWithinSendWindow(hour, row.send_start_hour, row.send_end_hour)) {
      return jsonResponse({ error: "fora_da_janela", hour }, 200);
    }

    // 5. Instância conectada.
    const { data: instance } = await service
      .from("whatsapp_instances")
      .select("evolution_instance_name, connection_status")
      .eq("tenant_id", row.tenant_id)
      .maybeSingle();
    const instanceRow = instance as
      | { evolution_instance_name: string; connection_status: string }
      | null;
    if (!instanceRow || instanceRow.connection_status !== "conectado") {
      await service.rpc("campaign_release_stale_claims", {
        p_campaign_id: row.id,
        p_older_than_minutes: 0,
      });
      return jsonResponse({ error: "nao_conectado" }, 200);
    }

    // 6. Claim atômico + dreno.
    await service.rpc("campaign_release_stale_claims", {
      p_campaign_id: row.id,
      p_older_than_minutes: STALE_CLAIM_MINUTES,
    });
    const { data: claimed, error: claimError } = await service.rpc(
      "campaign_claim_sends",
      { p_campaign_id: row.id, p_limit: body.limit },
    );
    if (claimError) return jsonResponse({ error: "internal_error" }, 500);

    const summary: DispatchSummary = {
      processed: 0,
      sent: 0,
      excluded_opt_in: 0,
      frequency_capped: 0,
      failed: 0,
      completed: false,
    };
    const adapter = (deps.createAdapter ?? createEvolutionAdapter)();
    const companyName = ((tenantRow["trade_name"] as string | null) ?? "").trim() ||
      ((tenantRow["legal_name"] as string | null) ?? "").trim() ||
      null;
    const cutoff = new Date(now().getTime() - 30 * 24 * 3600 * 1000).toISOString();

    for (const send of ((claimed ?? []) as ClaimedSend[])) {
      summary.processed++;
      const { data: customer } = await service
        .from("customers")
        .select("name, phone, whatsapp_opt_in, active")
        .eq("tenant_id", send.tenant_id)
        .eq("id", send.customer_id)
        .maybeSingle();
      const cust = customer as
        | { name: string; phone: string; whatsapp_opt_in: boolean; active: boolean }
        | null;
      if (!cust || cust.active === false || !cust.whatsapp_opt_in) {
        await service
          .from("campaign_sends")
          .update({
            status: "excluded_opt_in",
            provider_message_id: null,
            claimed_at: null,
            failure_reason: "opt_in_ausente",
          })
          .eq("id", send.send_id);
        summary.excluded_opt_in++;
        continue;
      }

      // Teto de frequência: enviados a este cliente nos últimos 30d (outras campanhas).
      const { count } = await service
        .from("campaign_sends")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", send.tenant_id)
        .eq("customer_id", send.customer_id)
        .neq("campaign_id", row.id)
        .gte("sent_at", cutoff);
      if ((count ?? 0) >= row.max_per_customer_30d) {
        await service
          .from("campaign_sends")
          .update({
            status: "failed",
            provider_message_id: null,
            claimed_at: null,
            failure_reason: "frequency_capped",
          })
          .eq("id", send.send_id);
        summary.frequency_capped++;
        continue;
      }

      try {
        const result = await adapter.sendText({
          instanceName: instanceRow.evolution_instance_name,
          to: cust.phone,
          text: renderCampaignBody(templateRow.body, cust.name, companyName),
        });
        const { error: updateError } = await service
          .from("campaign_sends")
          .update({
            status: "sent",
            provider_message_id: result.providerMessageId,
            claimed_at: null,
            sent_at: now().toISOString(),
            failure_reason: null,
          })
          .eq("id", send.send_id);
        if (updateError) {
          summary.failed++;
        } else {
          summary.sent++;
        }
      } catch {
        await service
          .from("campaign_sends")
          .update({
            status: "failed",
            provider_message_id: null,
            claimed_at: null,
            failure_reason: "provider_error",
          })
          .eq("id", send.send_id);
        summary.failed++;
      }
    }

    // 7. Conclui quando nada resta na fila.
    const { count: remaining } = await service
      .from("campaign_sends")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", row.tenant_id)
      .eq("campaign_id", row.id)
      .eq("status", "queued");
    if ((remaining ?? 0) === 0) {
      await service
        .from("campaigns")
        .update({ status: "concluída", updated_at: now().toISOString() })
        .eq("id", row.id);
      summary.completed = true;
    }

    return jsonResponse({ ok: true, ...summary }, 200);
  };
}
