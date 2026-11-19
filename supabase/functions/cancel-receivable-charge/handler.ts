// Cancelamento do PIX de uma conta a RECEBER avulsa (Fase 5 ADR-07, revisão 1).
//
// Por que existe: `receivable_settle` e `receivable_cancel` recusam conta com PIX
// vivo (PT409 `RECEIVABLE_HAS_ACTIVE_CHARGE`) — baixar/cancelar a conta com um QR
// pagável na mão do cliente geraria caixa não registrado. A única forma de voltar
// a conta para o estado "sem cobrança" é matar o PIX no gateway e limpar os
// campos locais, que é exatamente o que esta Edge faz (admin-only, auditado).
//
// Idempotente: conta sem `asaas_payment_id` responde 200 `cancelled: false`.
// Falha do gateway (fora 404) ⇒ 422 `GATEWAY_CANCEL_FAILED` e NADA é limpo: o
// PIX continua vivo do lado do Asaas e a UI mostra o motivo em pt-BR.
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import {
  asaasBaseUrl,
  cancelPayment,
  decryptText,
} from "../_shared/asaas.ts";
import { resolveIdentity } from "../_shared/identity.ts";
import {
  ApiError,
  CORS_HEADERS,
  errorResponse,
  jsonResponse,
  logEvent,
  mapRpcError,
  messageForCode,
} from "../_shared/http.ts";
import { requestSchema } from "./schemas.ts";

export type HandlerOptions = { createService: () => SupabaseClient };

interface ReceivableRow {
  id: string;
  status: string;
  asaas_payment_id: string | null;
}

interface GatewayConfig {
  baseUrl: string;
  apiKey: string;
}

export function createHandler(options: HandlerOptions) {
  return async (req: Request): Promise<Response> => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
    if (req.method !== "POST") {
      return jsonResponse(
        { code: "METHOD_NOT_ALLOWED", message: messageForCode("METHOD_NOT_ALLOWED") },
        405,
      );
    }

    let service: SupabaseClient;
    try {
      service = options.createService();
    } catch {
      return jsonResponse({ code: "INTERNAL", message: messageForCode("INTERNAL") }, 500);
    }

    try {
      const identity = await resolveIdentity(req, service, ["admin"]);

      let raw: unknown;
      try {
        raw = await req.json();
      } catch {
        throw new ApiError(400, "INVALID_BODY");
      }
      const parsed = requestSchema.safeParse(raw);
      if (!parsed.success) throw new ApiError(400, "INVALID_BODY");

      const receivable = await loadReceivable(
        service,
        identity.tenantId,
        parsed.data.receivable_id,
      );
      if (receivable.status === "pago") throw new ApiError(409, "RECEIVABLE_ALREADY_PAID");
      if (receivable.status === "cancelado") throw new ApiError(409, "RECEIVABLE_CANCELLED");

      if (receivable.asaas_payment_id === null) {
        return jsonResponse(
          { receivable_id: receivable.id, status: receivable.status, cancelled: false },
          200,
        );
      }

      const config = await loadGatewayConfig(service, identity.tenantId);
      if (!config) throw new ApiError(422, "ASAAS_NOT_CONFIGURED");

      const cancelled = await cancelPayment(
        config.baseUrl,
        config.apiKey,
        receivable.asaas_payment_id,
      );
      if (!cancelled.ok && !cancelled.notFound) {
        throw new ApiError(422, "GATEWAY_CANCEL_FAILED");
      }

      const cleared = await clearGatewayData(
        service,
        identity.tenantId,
        receivable.id,
        receivable.asaas_payment_id,
      );
      if (!cleared) {
        const latest = await loadReceivable(service, identity.tenantId, receivable.id);
        if (latest.status === "pago") throw new ApiError(409, "RECEIVABLE_ALREADY_PAID");
        throw new ApiError(409, "RECEIVABLE_CHARGE_CHANGED");
      }

      await writeAudit(service, identity.tenantId, identity.userId, receivable);

      logEvent("receivable_charge_cancelled", {
        tenant_id: identity.tenantId,
        actor_id: identity.userId,
        receivable_id: receivable.id,
        code: cancelled.notFound ? "GATEWAY_NOT_FOUND" : "CANCELLED",
      });

      return jsonResponse(
        { receivable_id: receivable.id, status: "pendente", cancelled: true },
        200,
      );
    } catch (error) {
      return errorResponse(error);
    }
  };
}

async function loadReceivable(
  service: SupabaseClient,
  tenantId: string,
  receivableId: string,
): Promise<ReceivableRow> {
  const { data, error } = await service
    .from("receivables")
    .select("id, status, asaas_payment_id")
    .eq("tenant_id", tenantId)
    .eq("id", receivableId)
    .maybeSingle();
  if (error) throw new ApiError(500, "INTERNAL");
  if (!data) throw new ApiError(404, "RECEIVABLE_NOT_FOUND");
  return data as ReceivableRow;
}

async function loadGatewayConfig(
  service: SupabaseClient,
  tenantId: string,
): Promise<GatewayConfig | null> {
  const { data, error } = await service
    .from("tenant_asaas_config")
    .select("active, environment, asaas_api_key_encrypted")
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (error) throw new ApiError(500, "INTERNAL");
  if (!data || data.active !== true || !data.asaas_api_key_encrypted) return null;
  try {
    return {
      baseUrl: asaasBaseUrl(data.environment === "production" ? "production" : "sandbox"),
      apiKey: await decryptText(data.asaas_api_key_encrypted as string),
    };
  } catch {
    throw new ApiError(500, "INTERNAL");
  }
}

/** Limpa os campos do gateway com fence no id cancelado. `false` = linha mudou. */
async function clearGatewayData(
  service: SupabaseClient,
  tenantId: string,
  receivableId: string,
  expectedPaymentId: string,
): Promise<boolean> {
  const { data, error } = await service.rpc("clear_receivable_gateway_data", {
    p_tenant_id: tenantId,
    p_receivable_id: receivableId,
    p_expected_payment_id: expectedPaymentId,
  });
  if (error) throw mapRpcError(error);
  return (data as { cleared?: boolean } | null)?.cleared === true;
}

async function writeAudit(
  service: SupabaseClient,
  tenantId: string,
  actorId: string,
  receivable: ReceivableRow,
): Promise<void> {
  const { error } = await service.from("audit_log").insert({
    tenant_id: tenantId,
    actor_id: actorId,
    action: "receivable_charge_cancelled",
    target_type: "receivable",
    target_id: receivable.id,
    metadata: {
      receivable_id: receivable.id,
      previous_payment_id: receivable.asaas_payment_id,
    },
  });
  if (error) throw new ApiError(500, "INTERNAL");
}
