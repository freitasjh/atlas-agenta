import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { asaasBaseUrl, cancelPayment, decryptText } from "../_shared/asaas.ts";
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
      const identity = await resolveIdentity(req, service, ["admin", "receptionist"]);

      let raw: unknown;
      try {
        raw = await req.json();
      } catch {
        throw new ApiError(400, "INVALID_BODY");
      }
      const parsed = requestSchema.safeParse(raw);
      if (!parsed.success) throw new ApiError(400, "INVALID_BODY");
      const body = parsed.data;

      if (body.force && identity.role !== "admin") throw new ApiError(403, "FORBIDDEN");

      const { data: charge, error } = await service
        .from("charges")
        .select("id, status, asaas_payment_id")
        .eq("tenant_id", identity.tenantId)
        .eq("id", body.charge_id)
        .maybeSingle();
      if (error) throw new ApiError(500, "INTERNAL");
      if (!charge) throw new ApiError(404, "CHARGE_NOT_FOUND");

      if (charge.status === "cancelado") {
        return jsonResponse(
          {
            cancelled: true,
            replayed: true,
            charge_id: charge.id,
            gateway_divergence_risk: false,
          },
          200,
        );
      }
      if (charge.status === "pago") throw new ApiError(409, "CHARGE_NOT_PENDING");

      let gatewayCancelled = true;
      if (charge.asaas_payment_id) {
        const config = await loadGatewayConfig(service, identity.tenantId);
        if (!config) {
          gatewayCancelled = false;
        } else {
          const result = await cancelPayment(
            config.baseUrl,
            config.apiKey,
            String(charge.asaas_payment_id),
          );
          gatewayCancelled = result.ok || result.notFound;
        }
      }

      if (gatewayCancelled) {
        const { data, error: rpcError } = await service.rpc("cancel_charge", {
          p_tenant_id: identity.tenantId,
          p_charge_id: body.charge_id,
          p_actor_id: identity.userId,
          p_force: false,
          p_gateway_cancelled: true,
        });
        if (rpcError) throw mapRpcError(rpcError);
        const result = (data ?? {}) as Record<string, unknown>;
        logEvent("charge_cancelled", {
          tenant_id: identity.tenantId,
          actor_id: identity.userId,
          charge_id: body.charge_id,
          replayed: result.replayed === true,
        });
        return jsonResponse(
          {
            cancelled: true,
            replayed: result.replayed === true,
            charge_id: body.charge_id,
            gateway_divergence_risk: false,
          },
          200,
        );
      }

      if (body.force && identity.role === "admin") {
        const { data, error: rpcError } = await service.rpc("cancel_charge", {
          p_tenant_id: identity.tenantId,
          p_charge_id: body.charge_id,
          p_actor_id: identity.userId,
          p_force: true,
          p_gateway_cancelled: false,
        });
        if (rpcError) throw mapRpcError(rpcError);
        const result = (data ?? {}) as Record<string, unknown>;
        logEvent("charge_cancelled_forced", {
          tenant_id: identity.tenantId,
          actor_id: identity.userId,
          charge_id: body.charge_id,
          replayed: result.replayed === true,
        });
        return jsonResponse(
          {
            cancelled: true,
            replayed: result.replayed === true,
            charge_id: body.charge_id,
            gateway_divergence_risk: true,
          },
          200,
        );
      }

      throw new ApiError(422, "GATEWAY_CANCEL_FAILED");
    } catch (error) {
      return errorResponse(error);
    }
  };
}

async function loadGatewayConfig(
  service: SupabaseClient,
  tenantId: string,
): Promise<{ baseUrl: string; apiKey: string } | null> {
  const { data: config, error } = await service
    .from("tenant_asaas_config")
    .select("active, environment, asaas_api_key_encrypted")
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (error) throw new ApiError(500, "INTERNAL");
  if (!config || config.active !== true || !config.asaas_api_key_encrypted) return null;
  try {
    return {
      baseUrl: asaasBaseUrl(config.environment === "production" ? "production" : "sandbox"),
      apiKey: await decryptText(config.asaas_api_key_encrypted as string),
    };
  } catch {
    return null;
  }
}
