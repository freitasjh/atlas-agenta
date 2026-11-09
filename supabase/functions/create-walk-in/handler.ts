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

/** Ramos que vendem no PDV (salão/barbearia, `payments === true`). */
const PDV_SEGMENTS = ["salao", "barbearia"] as const;

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
      if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
        throw new ApiError(400, "INVALID_BODY");
      }
      const parsed = requestSchema.safeParse(raw);
      if (!parsed.success) throw new ApiError(400, "INVALID_BODY");
      const body = parsed.data;

      // Gate de produto por ramo (nunca RLS por segment): fora de
      // salão/barbearia o PDV não vende. `segment` vem do banco, nunca do corpo.
      const { data: tenant, error: tenantError } = await service
        .from("tenants")
        .select("segment")
        .eq("id", identity.tenantId)
        .maybeSingle();
      if (tenantError) throw new ApiError(500, "INTERNAL");
      if (!(PDV_SEGMENTS as readonly string[]).includes(String(tenant?.segment ?? ""))) {
        throw new ApiError(409, "SEGMENT_NOT_ENABLED");
      }

      // Vínculo N:N vigente (única regra nova): serviço de venda avulsa precisa
      // ser oferecido pelo profissional. Combo segue o RPC (`active`).
      if (body.service_id != null) {
        const { data: link, error: linkError } = await service
          .from("service_professionals")
          .select("id")
          .eq("tenant_id", identity.tenantId)
          .eq("service_id", body.service_id)
          .eq("professional_id", body.professional_id)
          .maybeSingle();
        if (linkError) throw new ApiError(500, "INTERNAL");
        if (!link) throw new ApiError(409, "SERVICE_NOT_OFFERED");
      }

      const { data: created, error: rpcError } = await service.rpc(
        "create_walk_in_appointment",
        {
          p_tenant_id: identity.tenantId,
          p_actor_id: identity.userId,
          p_professional_id: body.professional_id,
          p_service_id: body.service_id ?? null,
          p_combo_id: body.combo_id ?? null,
          p_customer_id: body.customer_id ?? null,
          p_creation_idempotency_key: body.creation_idempotency_key,
        },
      );
      if (rpcError) throw mapRpcError(rpcError);

      const result = (created ?? {}) as Record<string, unknown>;
      const appointmentId = String(result.id ?? "");
      if (!appointmentId) throw new ApiError(500, "INTERNAL");
      const reused = result.reused === true;

      logEvent("walk_in_created", {
        tenant_id: identity.tenantId,
        actor_id: identity.userId,
        appointment_id: appointmentId,
      });

      return jsonResponse({ appointment_id: appointmentId, reused }, reused ? 200 : 201);
    } catch (error) {
      return errorResponse(error);
    }
  };
}
