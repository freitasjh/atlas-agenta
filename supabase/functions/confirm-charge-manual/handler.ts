import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
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
import { loadSettlement } from "../_shared/payments.ts";
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
      const identity = await resolveIdentity(req, service, ["admin"]);

      let raw: unknown;
      try {
        raw = await req.json();
      } catch {
        throw new ApiError(400, "INVALID_BODY");
      }
      const parsed = requestSchema.safeParse(raw);
      if (!parsed.success) throw new ApiError(400, "INVALID_BODY");
      const body = parsed.data;

      const { data: charge, error } = await service
        .from("charges")
        .select("id, status, appointment_id")
        .eq("tenant_id", identity.tenantId)
        .eq("id", body.charge_id)
        .maybeSingle();
      if (error) throw new ApiError(500, "INTERNAL");
      if (!charge) throw new ApiError(404, "CHARGE_NOT_FOUND");
      if (charge.status === "cancelado") throw new ApiError(409, "CHARGE_CANCELLED");

      const { data, error: rpcError } = await service.rpc("settle_charge_payment", {
        p_tenant_id: identity.tenantId,
        p_charge_id: body.charge_id,
        p_paid_at: body.paid_at ?? null,
        p_source: "manual",
        p_actor_id: identity.userId,
        p_event_id: null,
      });
      if (rpcError) throw mapRpcError(rpcError);

      const result = (data ?? {}) as Record<string, unknown>;
      const settlement = charge.appointment_id
        ? await loadSettlement(service, identity, charge.appointment_id as string)
        : null;

      logEvent("charge_paid_manual", {
        tenant_id: identity.tenantId,
        actor_id: identity.userId,
        charge_id: body.charge_id,
        replayed: result.replayed === true,
      });

      return jsonResponse(
        {
          settlement,
          payment: result.payment ?? null,
          replayed: result.replayed === true,
        },
        200,
      );
    } catch (error) {
      return errorResponse(error);
    }
  };
}
