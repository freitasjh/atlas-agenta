import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { isProfessionalOwner, resolveIdentity } from "../_shared/identity.ts";
import {
  ApiError,
  CORS_HEADERS,
  errorResponse,
  jsonResponse,
  logEvent,
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
      const identity = await resolveIdentity(req, service, [
        "admin",
        "receptionist",
        "professional",
      ]);

      let raw: unknown;
      try {
        raw = await req.json();
      } catch {
        throw new ApiError(400, "INVALID_BODY");
      }
      const parsed = requestSchema.safeParse(raw);
      if (!parsed.success) throw new ApiError(400, "INVALID_BODY");

      const { data: appointment, error } = await service
        .from("appointments")
        .select("id, professional_id")
        .eq("tenant_id", identity.tenantId)
        .eq("id", parsed.data.appointment_id)
        .maybeSingle();
      if (error) throw new ApiError(500, "INTERNAL");
      if (!appointment) throw new ApiError(404, "APPOINTMENT_NOT_FOUND");

      if (identity.role === "professional") {
        const owns = await isProfessionalOwner(
          service,
          identity.tenantId,
          identity.userId,
          appointment.professional_id as string,
        );
        if (!owns) throw new ApiError(403, "PROFESSIONAL_NOT_OWNER");
      }

      const settlement = await loadSettlement(service, identity, parsed.data.appointment_id);
      logEvent("settlement_read", {
        tenant_id: identity.tenantId,
        actor_id: identity.userId,
        appointment_id: parsed.data.appointment_id,
      });
      return jsonResponse(settlement, 200);
    } catch (error) {
      return errorResponse(error);
    }
  };
}
