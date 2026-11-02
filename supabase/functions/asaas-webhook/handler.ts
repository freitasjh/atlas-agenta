import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { z } from "npm:zod@3.23.8";
import { constantTimeEqual } from "../_shared/asaas.ts";
import { payloadSchema } from "./schemas.ts";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, asaas-access-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

export type HandlerOptions = { createService: () => SupabaseClient };
export function createHandler(options: HandlerOptions) {
  return async (req: Request): Promise<Response> => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
    if (req.method !== "POST") return jsonResponse({ error: "Método não suportado." }, 405);
    let service: SupabaseClient;
    try { service = options.createService(); } catch { return jsonResponse({ error: "Erro de configuração do servidor." }, 500); }

    const headerToken = (req.headers.get("asaas-access-token") ?? "").trim();
    if (!headerToken) return jsonResponse({ error: "Token ausente." }, 401);

    const rawText = await req.text();
    let raw: unknown;
    try { raw = JSON.parse(rawText); } catch { return jsonResponse({ error: "Corpo inválido." }, 400); }
    const parsed = payloadSchema.safeParse(raw);
    if (!parsed.success) return jsonResponse({ error: "Dados inválidos." }, 400);
    const event = parsed.data.event;
    const paymentId = parsed.data.payment?.id;
    if (!paymentId) return jsonResponse({ ok: true }, 200);

    const globalToken = (Deno.env.get("ASAAS_WEBHOOK_TOKEN") ?? "").trim();
    if (globalToken) {
      if (!constantTimeEqual(headerToken, globalToken)) return jsonResponse({ error: "Token inválido." }, 401);
    }

    // lookup charge
    const { data: charge } = await service.from("charges").select("*").eq("asaas_payment_id", paymentId).maybeSingle();
    if (!charge) {
      if (!globalToken) return jsonResponse({ error: "Token inválido." }, 401);
      return jsonResponse({ ok: true }, 200);
    }

    if (!globalToken) {
      const { data: cfg } = await service.from("tenant_asaas_config").select("asaas_webhook_token").eq("tenant_id", charge.tenant_id).maybeSingle();
      const tenantToken = (cfg?.asaas_webhook_token ?? "").trim();
      if (!tenantToken || !constantTimeEqual(headerToken, tenantToken)) return jsonResponse({ error: "Token inválido." }, 401);
    }

    // idempotência via webhook_events
    const eventId = (parsed.data as any)?.id ?? event;
    const { data: existingEvent } = await service.from("webhook_events").select("id").eq("event_id", eventId).eq("payment_id", paymentId).maybeSingle();
    if (existingEvent) return jsonResponse({ ok: true }, 200);

    const { error: insEvErr } = await service.from("webhook_events").insert({
      event_id: eventId,
      payment_id: paymentId,
      event_type: event,
      tenant_id: charge.tenant_id,
      external_event_id: eventId,
      instance_name: "asaas",
      source: "evolution",
    });
    // ignore duplicate race
    if (insEvErr && !String(insEvErr.message ?? "").toLowerCase().includes("duplicate")) {
      return jsonResponse({ error: "Falha ao registrar evento." }, 500);
    }

    if (event === "PAYMENT_RECEIVED" || event === "PAYMENT_CONFIRMED") {
      if (charge.status !== "pago") {
        const { error: updErr } = await service.from("charges").update({ status: "pago", paid_at: new Date().toISOString() }).eq("id", charge.id);
        if (updErr) return jsonResponse({ error: "Falha ao atualizar cobrança." }, 500);
        const { error: auditErr } = await service.from("audit_log").insert({ tenant_id: charge.tenant_id, action: "charge_paid", target_type: "charge", target_id: charge.id, metadata: { event } });
        if (auditErr) return jsonResponse({ error: "Falha ao registrar auditoria." }, 500);
      }
    } else if (event === "PAYMENT_OVERDUE") {
      if (charge.status !== "expirado") {
        const { error: updErr } = await service.from("charges").update({ status: "expirado" }).eq("id", charge.id);
        if (updErr) return jsonResponse({ error: "Falha ao atualizar cobrança." }, 500);
        const { error: auditErr } = await service.from("audit_log").insert({ tenant_id: charge.tenant_id, action: "charge_expired", target_type: "charge", target_id: charge.id, metadata: { event } });
        if (auditErr) return jsonResponse({ error: "Falha ao registrar auditoria." }, 500);
      }
    }
    return jsonResponse({ ok: true }, 200);
  };
}
