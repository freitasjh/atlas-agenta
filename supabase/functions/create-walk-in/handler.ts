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

function normalizeBody(raw: Record<string, unknown>): Record<string, unknown> {
  const body: Record<string, unknown> = { ...raw };
  const sel = body.selection;
  if (sel && typeof sel === "object" && !Array.isArray(sel)) {
    const s = sel as Record<string, unknown>;
    if (s.kind === "service") {
      if (body.service_id == null) body.service_id = s.serviceId ?? s.service_id;
    } else if (s.kind === "combo") {
      if (body.combo_id == null) body.combo_id = s.comboId ?? s.combo_id;
    } else if (s.kind === "product") {
      if (body.product_id == null) body.product_id = s.productId ?? s.product_id ?? s.id;
      if (body.product_qty == null) body.product_qty = s.qty ?? s.quantity ?? s.product_qty;
    }
  }
  if (body.productId != null && body.product_id == null) body.product_id = body.productId;
  if (body.productQty != null && body.product_qty == null) body.product_qty = body.productQty;
  if (body.qty != null && body.product_qty == null && body.product_id != null) body.product_qty = body.qty;
  delete body.selection;
  delete body.productId;
  delete body.productQty;
  return body;
}

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
      // Normaliza entrada aninhada (selection.kind) e camelCase para o schema plano.
      const normalized = normalizeBody(raw as Record<string, unknown>);
      const parsed = requestSchema.safeParse(normalized);
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
      // ser oferecido pelo profissional. Combo/produto seguem o RPC (`active`).
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
          p_product_id: body.product_id ?? null,
          p_product_qty: body.product_qty ?? 0,
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
