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

      const { data, error } = await service.rpc("void_appointment_payment", {
        p_tenant_id: identity.tenantId,
        p_payment_id: body.payment_id,
        p_actor_id: identity.userId,
        p_reason: body.reason,
      });
      if (error) throw mapRpcError(error);

      const result = (data ?? {}) as Record<string, unknown>;

      logEvent("payment_voided", {
        tenant_id: identity.tenantId,
        actor_id: identity.userId,
        payment_id: body.payment_id,
        replayed: result.replayed === true,
        reason_length: body.reason.trim().length,
      });

      return jsonResponse(
        {
          settlement: result.settlement ?? null,
          refund_required: result.refund_required === true,
          replayed: result.replayed === true,
        },
        200,
      );
    } catch (error) {
      return errorResponse(error);
    }
  };
}
