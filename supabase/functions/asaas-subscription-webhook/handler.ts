import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { z } from "npm:zod@3.23.8";
import { constantTimeEqual } from "../_shared/asaas.ts";
import { beginEvent, finishEvent } from "../asaas-webhook/dedupe.ts";
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

    const secret = (Deno.env.get("ASAAS_SUBSCRIPTION_WEBHOOK_TOKEN") ?? Deno.env.get("ASAAS_WEBHOOK_TOKEN") ?? "").trim();
    if (!secret || !constantTimeEqual(headerToken, secret)) return jsonResponse({ error: "Token inválido." }, 401);

    const { data: charge } = await service.from("subscription_charges").select("*").eq("asaas_payment_id", paymentId).maybeSingle();
    if (!charge) return jsonResponse({ ok: true }, 200);

    const eventId = String((parsed.data as any)?.id ?? event);

    // Dedupe durável: insert sem `processed_at`; só vira `now()` depois do efeito.
    let begin: "process" | "already_processed";
    try {
      begin = await beginEvent(service, {
        tenantId: charge.tenant_id,
        eventId,
        paymentId,
        eventType: event,
      });
    } catch {
      return jsonResponse({ error: "Falha ao registrar evento." }, 500);
    }
    if (begin === "already_processed") return jsonResponse({ ok: true }, 200);

    if (event === "PAYMENT_RECEIVED" || event === "PAYMENT_CONFIRMED") {
      if (charge.status !== "pago") {
        const { error: updErr } = await service.from("subscription_charges").update({ status: "pago", paid_at: new Date().toISOString() }).eq("id", charge.id);
        if (updErr) return jsonResponse({ error: "Falha ao atualizar cobrança." }, 500);
        const { error: tErr } = await service.from("tenants").update({ subscription_status: "ativo" }).eq("id", charge.tenant_id);
        if (tErr) return jsonResponse({ error: "Falha ao atualizar tenant." }, 500);
        const { error: auditErr } = await service.from("audit_log").insert({ tenant_id: charge.tenant_id, action: "subscription_paid", target_type: "subscription_charge", target_id: charge.id, metadata: { event } });
        if (auditErr) return jsonResponse({ error: "Falha ao registrar auditoria." }, 500);
      }
    } else if (event === "PAYMENT_OVERDUE") {
      if (charge.status !== "expirado") {
        const { error: updErr } = await service.from("subscription_charges").update({ status: "expirado" }).eq("id", charge.id);
        if (updErr) return jsonResponse({ error: "Falha ao atualizar cobrança." }, 500);
      }
    }

    try {
      await finishEvent(service, eventId, paymentId);
    } catch {
      return jsonResponse({ error: "Falha ao marcar evento." }, 500);
    }
    return jsonResponse({ ok: true }, 200);
  };
}
