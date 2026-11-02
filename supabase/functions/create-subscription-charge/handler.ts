import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { z } from "npm:zod@3.23.8";
import { asaasBaseUrl, asaasFetch } from "../_shared/asaas.ts";
import { requestSchema } from "./schemas.ts";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
async function resolveIdentity(req: Request, service: SupabaseClient) {
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return null;
  const { data, error } = await service.auth.getUser(token);
  if (error || !data.user) return null;
  const { data: profile } = await service.from("profiles").select("tenant_id, role").eq("id", data.user.id).maybeSingle();
  if (!profile || profile.role !== "super_admin") return null;
  return { userId: data.user.id };
}

const PLAN_AMOUNTS: Record<string, number> = {
  individual: 9900,
  clinica: 19900,
  pro: 39900,
};

export type HandlerOptions = { createService: () => SupabaseClient };
export function createHandler(options: HandlerOptions) {
  return async (req: Request): Promise<Response> => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
    if (req.method !== "POST") return jsonResponse({ error: "Método não suportado." }, 405);
    let service: SupabaseClient;
    try { service = options.createService(); } catch { return jsonResponse({ error: "Erro de configuração do servidor." }, 500); }
    const identity = await resolveIdentity(req, service);
    if (!identity) return jsonResponse({ error: "Sessão inválida ou expirada." }, 401);
    let raw: unknown;
    try { raw = await req.json(); } catch { return jsonResponse({ error: "Corpo inválido." }, 400); }
    const parsed = requestSchema.safeParse(raw);
    if (!parsed.success) return jsonResponse({ error: "Dados inválidos.", issues: parsed.error.issues.map((i) => i.message) }, 400);
    const input = parsed.data;

    const apiKey = Deno.env.get("ASAAS_SUPER_ADMIN_API_KEY");
    if (!apiKey) return jsonResponse({ error: "Asaas super admin não configurado." }, 500);
    const env = (Deno.env.get("ASAAS_SUPER_ADMIN_ENVIRONMENT") ?? "production") as "sandbox" | "production";
    const baseUrl = asaasBaseUrl(env);

    const monthly = PLAN_AMOUNTS[input.plan] ?? 9900;
    const amount = input.billing_period === "annual" ? monthly * 10 : monthly;

    const { data: tenant } = await service.from("tenants").select("name").eq("id", input.tenant_id).maybeSingle();
    const custRes = await asaasFetch(baseUrl, apiKey, "/customers", "POST", { name: tenant?.name ?? "Tenant" });
    const asaasCustomerId = custRes.ok ? custRes.data?.id : null;
    if (!asaasCustomerId) return jsonResponse({ error: "Falha ao criar cliente." }, 500);

    const expiresAt = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
    const paymentRes = await asaasFetch(baseUrl, apiKey, "/payments", "POST", {
      customer: asaasCustomerId,
      billingType: "PIX",
      value: amount / 100,
      dueDate: expiresAt.slice(0, 10),
      description: `Assinatura ${input.plan}`,
      externalReference: input.tenant_id,
    });
    if (!paymentRes.ok) return jsonResponse({ error: "Falha ao criar cobrança." }, 500);
    const paymentId = paymentRes.data?.id;
    const pixRes = await asaasFetch(baseUrl, apiKey, `/payments/${paymentId}/pixQrCode`);
    const pixQr = pixRes.ok ? pixRes.data?.encodedImage : null;
    const pixCopy = pixRes.ok ? pixRes.data?.payload : null;

    const { data: charge, error: insErr } = await service.from("subscription_charges").insert({
      tenant_id: input.tenant_id,
      asaas_payment_id: paymentId,
      status: "pendente",
      amount_cents: amount,
      plan: input.plan,
      billing_period: input.billing_period,
      pix_qr_code: pixQr,
      pix_copy_paste: pixCopy,
      expires_at: expiresAt,
    }).select().single();
    if (insErr) return jsonResponse({ error: "Falha ao salvar." }, 500);

    const { error: auditErr } = await service.from("audit_log").insert({
      tenant_id: input.tenant_id,
      actor_id: identity.userId,
      action: "subscription_charge_created",
      target_type: "subscription_charge",
      target_id: charge.id,
      metadata: { plan: input.plan, amount_cents: amount },
    });
    if (auditErr) return jsonResponse({ error: "Falha ao registrar auditoria." }, 500);

    return jsonResponse({ charge_id: charge.id, pix_qr_code: pixQr, pix_copy_paste: pixCopy, expires_at: expiresAt }, 200);
  };
}
