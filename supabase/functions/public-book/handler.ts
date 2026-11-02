import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { parsePublicBookBody } from "./schemas.ts";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type ErrorCode =
  | "method_not_allowed"
  | "invalid_body"
  | "invalid_link"
  | "invalid_service"
  | "invalid_professional"
  | "slot_unavailable"
  | "internal_error";

const ERROR_STATUS: Record<ErrorCode, number> = {
  method_not_allowed: 405,
  invalid_body: 400,
  invalid_link: 404,
  invalid_service: 400,
  invalid_professional: 400,
  slot_unavailable: 409,
  internal_error: 500,
};

const ERROR_MESSAGES: Record<ErrorCode, string> = {
  method_not_allowed: "Método não suportado.",
  invalid_body: "Dados inválidos.",
  invalid_link: "Link inválido ou inativo.",
  invalid_service: "Serviço inválido.",
  invalid_professional: "Profissional inválido para o serviço.",
  slot_unavailable: "Horário indisponível.",
  internal_error: "Não foi possível concluir o agendamento. Tente novamente.",
};

function errorResponse(code: ErrorCode): Response {
  return new Response(JSON.stringify({ error: code, code, message: ERROR_MESSAGES[code] }), {
    status: ERROR_STATUS[code],
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function okResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

export type PublicBookHandlerOptions = { createService: () => SupabaseClient };

export function createPublicBookHandler(options: PublicBookHandlerOptions) {
  return async (req: Request): Promise<Response> => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
    if (req.method !== "POST") return errorResponse("method_not_allowed");

    let service: SupabaseClient;
    try {
      service = options.createService();
    } catch {
      return errorResponse("internal_error");
    }

    let rawBody: unknown;
    try {
      rawBody = await req.json();
    } catch {
      return errorResponse("invalid_body");
    }
    const parsed = parsePublicBookBody(rawBody);
    if (!parsed.ok) return errorResponse(parsed.code);
    const body = parsed.body;

    try {
      const { data: link } = await service
        .from("public_booking_links")
        .select("tenant_id, active")
        .eq("token", body.token)
        .single();

      if (!link || !link.active) return errorResponse("invalid_link");

      const tenantId = link.tenant_id as string;

      const { data: tenantRow } = await service
        .from("tenants")
        .select("timezone")
        .eq("id", tenantId)
        .single();
      const timezone = (tenantRow as { timezone?: string } | null)?.timezone?.trim() || "America/Sao_Paulo";

      const { data: serviceRow } = await service
        .from("services")
        .select("*")
        .eq("id", body.service_id)
        .eq("tenant_id", tenantId)
        .single();

      if (!serviceRow) return errorResponse("invalid_service");

      // valida profissional ↔ tenant/serviço
      const { data: professional } = await service
        .from("professionals")
        .select("id")
        .eq("id", body.professional_id)
        .eq("tenant_id", tenantId)
        .eq("active", true)
        .single();

      const { data: serviceProfessional } = await service
        .from("service_professionals")
        .select("professional_id")
        .eq("service_id", body.service_id)
        .eq("professional_id", body.professional_id)
        .eq("tenant_id", tenantId)
        .single();

      if (!professional || !serviceProfessional) return errorResponse("invalid_professional");

      const startsAt = new Date(body.starts_at);
      if (Number.isNaN(startsAt.getTime()) || startsAt.getTime() <= Date.now()) {
        return errorResponse("slot_unavailable");
      }

      // valida starts_at contra agenda via RPC (presença no slot)
      const dateStr = new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(startsAt);
      const { data: slots, error: slotsErr } = await service.rpc("public_booking_get_slots", {
        p_token: body.token,
        p_service_id: body.service_id,
        p_professional_id: body.professional_id,
        p_date: dateStr,
      });
      if (slotsErr) {
        console.error("public-book slots error", slotsErr);
        return errorResponse("internal_error");
      }
      const slotList = (slots || []) as { slot_start: string }[];
      const present = slotList.some((s) => new Date(s.slot_start).getTime() === startsAt.getTime());
      if (!present) return errorResponse("slot_unavailable");

      const endsAt = new Date(startsAt.getTime() + (serviceRow as { duration_minutes: number }).duration_minutes * 60000);

      // verifica conflito
      const { data: conflicts } = await service
        .from("appointments")
        .select("id")
        .eq("tenant_id", tenantId)
        .eq("professional_id", body.professional_id)
        .neq("status", "cancelado")
        .lt("starts_at", endsAt.toISOString())
        .gt("ends_at", startsAt.toISOString());

      if (conflicts && conflicts.length > 0) return errorResponse("slot_unavailable");

      // cria ou busca cliente
      let customerId: string;
      const { data: existingCustomer } = await service
        .from("customers")
        .select("id")
        .eq("tenant_id", tenantId)
        .eq("phone", body.customer_phone)
        .single();

      if (existingCustomer) {
        customerId = (existingCustomer as { id: string }).id;
      } else {
        const { data: newCustomer, error: custErr } = await service
          .from("customers")
          .insert({
            tenant_id: tenantId,
            name: body.customer_name,
            phone: body.customer_phone,
          })
          .select("id")
          .single();

        if (custErr || !newCustomer) {
          console.error("public-book customer error", custErr);
          return errorResponse("internal_error");
        }
        customerId = (newCustomer as { id: string }).id;
      }

      const { data: appointment, error: appErr } = await service
        .from("appointments")
        .insert({
          tenant_id: tenantId,
          customer_id: customerId,
          professional_id: body.professional_id,
          service_id: body.service_id,
          starts_at: startsAt.toISOString(),
          ends_at: endsAt.toISOString(),
          price_cents: (serviceRow as { price_cents: number }).price_cents,
          status: "pendente",
        })
        .select("id, status")
        .single();

      if (appErr) {
        const code = (appErr as { code?: string }).code;
        if (code === "23P01") return errorResponse("slot_unavailable");
        console.error("public-book appointment error", appErr);
        return errorResponse("internal_error");
      }
      if (!appointment) return errorResponse("internal_error");

      await service.from("audit_log").insert({
        tenant_id: tenantId,
        actor_id: null,
        action: "appointment_created_public",
        target_type: "appointment",
        target_id: (appointment as { id: string }).id,
        metadata: { service_id: body.service_id, professional_id: body.professional_id },
      });

      return okResponse(
        { success: true, appointment_id: (appointment as { id: string }).id, status: (appointment as { status: string }).status },
        201,
      );
    } catch (e) {
      console.error("public-book exception", e);
      return errorResponse("internal_error");
    }
  };
}