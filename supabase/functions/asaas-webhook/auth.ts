// Resolução do token esperado do webhook (tenant da cobrança × fallback global).
// Sem efeito colateral e sem log: o token nunca sai deste módulo.
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { constantTimeEqual } from "../_shared/asaas.ts";

export interface EnvLike {
  get(name: string): string | undefined;
}

export interface ChargeTenant {
  tenant_id: string;
}

/**
 * Token esperado para autenticar o evento:
 *  - cobrança conhecida ⇒ token do próprio tenant; vazio ⇒ fallback global;
 *  - cobrança desconhecida ⇒ somente o global (não há tenant para consultar);
 *  - nada configurado ⇒ `null` (fail-closed).
 */
export async function resolveExpectedToken(
  service: SupabaseClient,
  charge: ChargeTenant | null,
  env: EnvLike = Deno.env,
): Promise<string | null> {
  const globalToken = (env.get("ASAAS_WEBHOOK_TOKEN") ?? "").trim();
  if (!charge) return globalToken === "" ? null : globalToken;

  const { data, error } = await service
    .from("tenant_asaas_config")
    .select("asaas_webhook_token")
    .eq("tenant_id", charge.tenant_id)
    .maybeSingle();
  if (error) throw error;

  const tenantToken = String(data?.asaas_webhook_token ?? "").trim();
  if (tenantToken !== "") return tenantToken;
  return globalToken === "" ? null : globalToken;
}

/** Comparação em tempo constante; token ausente ou esperado ausente nunca autoriza. */
export function isAuthorized(headerToken: string, expectedToken: string | null): boolean {
  if (expectedToken === null || expectedToken === "") return false;
  if (headerToken === "") return false;
  return constantTimeEqual(headerToken, expectedToken);
}
