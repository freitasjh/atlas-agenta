import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { z } from "npm:zod@3.23.8";
import { asaasBaseUrl, asaasFetch, decryptText } from "../_shared/asaas.ts";
import { requestSchema } from "./schemas.ts";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
/**
 * Papéis que concluem atendimento e, portanto, podem gerar a cobrança PIX
 * operacional do agendamento (`admin`, `receptionist`, `professional` — os
 * mesmos de `canManageAppointments`). Leitura de `charges` continua restrita
 * por RLS/papel; esta permissão vale só para a escrita da Edge Function.
 */
const CHARGE_CREATOR_ROLES = ["admin", "receptionist", "professional"] as const;

type IdentityResult =
  | { ok: true; userId: string; tenantId: string; role: string }
  | { ok: false; status: 401 | 403; error: string };

async function resolveIdentity(req: Request, service: SupabaseClient): Promise<IdentityResult> {
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return { ok: false, status: 401, error: "Sessão inválida ou expirada." };
  const { data, error } = await service.auth.getUser(token);
  if (error || !data.user) return { ok: false, status: 401, error: "Sessão inválida ou expirada." };
  const { data: profile } = await service.from("profiles").select("tenant_id, role").eq("id", data.user.id).maybeSingle();
  const role = (profile?.role ?? "") as string;
  if (!(CHARGE_CREATOR_ROLES as readonly string[]).includes(role) || !profile?.tenant_id) {
    return { ok: false, status: 403, error: "Sem permissão para gerar cobrança." };
  }
  return { ok: true, userId: data.user.id, tenantId: profile.tenant_id as string, role };
}

export type HandlerOptions = { createService: () => SupabaseClient };
export function createHandler(options: HandlerOptions) {
  return async (req: Request): Promise<Response> => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
    if (req.method !== "POST") return jsonResponse({ error: "Método não suportado." }, 405);
    let service: SupabaseClient;
    try { service = options.createService(); } catch { return jsonResponse({ error: "Erro de configuração do servidor." }, 500); }
    const identity = await resolveIdentity(req, service);
    if (!identity.ok) return jsonResponse({ error: identity.error }, identity.status);
    let raw: unknown;
    try { raw = await req.json(); } catch { return jsonResponse({ error: "Corpo inválido." }, 400); }
    const parsed = requestSchema.safeParse(raw);
    if (!parsed.success) return jsonResponse({ error: "Dados inválidos.", issues: parsed.error.issues.map((i) => i.message) }, 400);
    const appointmentId = parsed.data.appointment_id;

    // idempotência
    const { data: existing } = await service.from("charges").select("*").eq("tenant_id", identity.tenantId).eq("appointment_id", appointmentId).maybeSingle();
    if (existing) {
      return jsonResponse({ charge_id: existing.id, pix_qr_code: existing.pix_qr_code, pix_copy_paste: existing.pix_copy_paste, expires_at: existing.expires_at }, 200);
    }

    // config
    const { data: cfg } = await service.from("tenant_asaas_config").select("*").eq("tenant_id", identity.tenantId).maybeSingle();
    if (!cfg || !cfg.active) return jsonResponse({ error: "Asaas não configurado." }, 400);
    let apiKey: string;
    try { apiKey = await decryptText(cfg.asaas_api_key_encrypted); } catch { return jsonResponse({ error: "Falha ao decriptar." }, 500); }
    const baseUrl = asaasBaseUrl(cfg.environment);

    // appointment
    const { data: appt } = await service.from("appointments").select("id, price_cents, status, customer_id, professional_id").eq("tenant_id", identity.tenantId).eq("id", appointmentId).maybeSingle();
    if (!appt) return jsonResponse({ error: "Agendamento não encontrado." }, 404);

    // Profissional só cobra o próprio atendimento (professionals.profile_id).
    if (identity.role === "professional") {
      const { data: professional } = await service.from("professionals").select("id").eq("tenant_id", identity.tenantId).eq("profile_id", identity.userId).maybeSingle();
      if (!professional || appt.professional_id !== professional.id) {
        return jsonResponse({ error: "Sem permissão para gerar cobrança deste agendamento." }, 403);
      }
    }

    if (appt.status !== "concluido") return jsonResponse({ error: "Agendamento não concluído." }, 400);

    // customer lookup by externalReference before creating
    const { data: cust } = await service.from("customers").select("name, email, phone").eq("tenant_id", identity.tenantId).eq("id", appt.customer_id).maybeSingle();
    let asaasCustomerId: string | null = null;
    const lookupRes = await asaasFetch(baseUrl, apiKey, `/customers?externalReference=${encodeURIComponent(String(appt.customer_id))}`);
    if (lookupRes.ok && Array.isArray(lookupRes.data?.data) && lookupRes.data.data.length > 0) {
      asaasCustomerId = lookupRes.data.data[0]?.id ?? null;
    }
    if (!asaasCustomerId) {
      const custRes = await asaasFetch(baseUrl, apiKey, "/customers", "POST", {
        name: cust?.name ?? "Cliente",
        email: cust?.email ?? undefined,
        phone: cust?.phone ?? undefined,
        externalReference: appt.customer_id,
      });
      asaasCustomerId = custRes.ok ? custRes.data?.id : null;
    }
    if (!asaasCustomerId) return jsonResponse({ error: "Falha ao criar cliente no Asaas." }, 500);

    const expiresAt = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
    const value = Number(((appt.price_cents ?? 0) / 100).toFixed(2));
    const paymentRes = await asaasFetch(baseUrl, apiKey, "/payments", "POST", {
      customer: asaasCustomerId,
      billingType: "PIX",
      value,
      dueDate: expiresAt.slice(0, 10),
      description: "Cobrança agendamento",
      externalReference: appointmentId,
    });
    if (!paymentRes.ok) return jsonResponse({ error: "Falha ao criar cobrança." }, 500);
    const paymentId = paymentRes.data?.id;
    const pixRes = await asaasFetch(baseUrl, apiKey, `/payments/${paymentId}/pixQrCode`);
    const pixQr = pixRes.ok ? pixRes.data?.encodedImage : null;
    const pixCopy = pixRes.ok ? pixRes.data?.payload : null;

    const { data: charge, error: insErr } = await service.from("charges").insert({
      tenant_id: identity.tenantId,
      appointment_id: appointmentId,
      asaas_payment_id: paymentId,
      status: "pendente",
      amount_cents: appt.price_cents ?? 0,
      pix_qr_code: pixQr,
      pix_copy_paste: pixCopy,
      expires_at: expiresAt,
    }).select().single();
    if (insErr) return jsonResponse({ error: "Falha ao salvar cobrança." }, 500);

    const { error: auditErr } = await service.from("audit_log").insert({
      tenant_id: identity.tenantId,
      actor_id: identity.userId,
      action: "charge_created",
      target_type: "charge",
      target_id: charge.id,
      metadata: { appointment_id: appointmentId, amount_cents: appt.price_cents },
    });
    if (auditErr) return jsonResponse({ error: "Falha ao registrar auditoria." }, 500);

    return jsonResponse({ charge_id: charge.id, pix_qr_code: pixQr, pix_copy_paste: pixCopy, expires_at: expiresAt }, 200);
  };
}
