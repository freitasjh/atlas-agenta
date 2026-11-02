import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { z } from "npm:zod@3.23.8";
import { asaasBaseUrl, asaasFetch, encryptText, randomHex } from "../_shared/asaas.ts";
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
  if (!profile || profile.role !== "admin" || !profile.tenant_id) return null;
  return { userId: data.user.id, tenantId: profile.tenant_id as string };
}

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
    const baseUrl = asaasBaseUrl(input.environment);
    const acct = await asaasFetch(baseUrl, input.apiKey, "/myAccount");
    if (!acct.ok) return jsonResponse({ error: "Chave inválida." }, 400);
    const encrypted = await encryptText(input.apiKey);
    const webhookToken = randomHex(24);
    const { error } = await service.from("tenant_asaas_config").upsert({
      tenant_id: identity.tenantId,
      asaas_api_key_encrypted: encrypted,
      asaas_webhook_token: webhookToken,
      asaas_account_id: acct.data?.id ?? null,
      environment: input.environment,
      active: true,
      updated_at: new Date().toISOString(),
    });
    if (error) return jsonResponse({ error: "Não foi possível salvar." }, 500);
    const { error: auditErr } = await service.from("audit_log").insert({
      tenant_id: identity.tenantId,
      actor_id: identity.userId,
      action: "asaas_config_saved",
      target_type: "tenant_asaas_config",
      target_id: identity.tenantId,
      metadata: { environment: input.environment, account_id: acct.data?.id },
    });
    if (auditErr) return jsonResponse({ error: "Falha ao registrar auditoria." }, 500);
    return jsonResponse({ ok: true, webhook_token: webhookToken, account_id: acct.data?.id }, 200);
  };
}
