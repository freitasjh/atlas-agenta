import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { parsePublicSlotsQuery } from "./schemas.ts";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

type ErrorCode =
  | "method_not_allowed"
  | "invalid_body"
  | "invalid_link"
  | "internal_error";

const ERROR_STATUS: Record<ErrorCode, number> = {
  method_not_allowed: 405,
  invalid_body: 400,
  invalid_link: 404,
  internal_error: 500,
};

const ERROR_MESSAGES: Record<ErrorCode, string> = {
  method_not_allowed: "Método não suportado.",
  invalid_body: "Dados inválidos.",
  invalid_link: "Link inválido ou inativo.",
  internal_error: "Não foi possível carregar os horários. Tente novamente.",
};

function errorResponse(code: ErrorCode): Response {
  return new Response(JSON.stringify({ error: code, code, message: ERROR_MESSAGES[code] }), {
    status: ERROR_STATUS[code],
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function okResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

export type PublicSlotsHandlerOptions = { createService: () => SupabaseClient };

export function createPublicSlotsHandler(options: PublicSlotsHandlerOptions) {
  return async (req: Request): Promise<Response> => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
    if (req.method !== "GET") return errorResponse("method_not_allowed");

    let service: SupabaseClient;
    try {
      service = options.createService();
    } catch {
      return errorResponse("internal_error");
    }

    const url = new URL(req.url);
    const raw = {
      token: url.searchParams.get("token"),
      service_id: url.searchParams.get("service_id"),
      professional_id: url.searchParams.get("professional_id") || null,
      date: url.searchParams.get("date"),
    };
    const parsed = parsePublicSlotsQuery(raw);
    if (!parsed.ok) return errorResponse(parsed.code);
    const q = parsed.query;

    try {
      const { data: link } = await service
        .from("public_booking_links")
        .select("tenant_id, active")
        .eq("token", q.token)
        .single();

      if (!link || !link.active) return errorResponse("invalid_link");

      const [servicesRes, professionalsRes, tenantRes] = await Promise.all([
        service.from("services").select("*").eq("tenant_id", link.tenant_id).eq("active", true),
        service.from("professionals").select("*").eq("tenant_id", link.tenant_id).eq("active", true),
        service.from("tenants").select("trade_name, legal_name, phone").eq("id", link.tenant_id).single(),
      ]);

      const { data: slots, error } = await service.rpc("public_booking_get_slots", {
        p_token: q.token,
        p_service_id: q.service_id,
        p_professional_id: q.professional_id ?? null,
        p_date: q.date,
      });

      if (error) {
        console.error("public-slots error", error);
        return errorResponse("internal_error");
      }

      const tenantRow = (tenantRes.data as { trade_name?: string | null; legal_name?: string | null; phone?: string | null } | null) || null;
      return okResponse({
        tenant_id: link.tenant_id,
        tenant: {
          trade_name: tenantRow?.trade_name ?? null,
          legal_name: tenantRow?.legal_name ?? null,
          phone: tenantRow?.phone ?? null,
        },
        services: servicesRes.data || [],
        professionals: professionalsRes.data || [],
        slots: slots || [],
      });
    } catch (e) {
      console.error("public-slots exception", e);
      return errorResponse("internal_error");
    }
  };
}