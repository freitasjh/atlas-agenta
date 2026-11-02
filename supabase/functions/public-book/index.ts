import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "method_not_allowed" }, 405);
  }

  try {
    const body = await req.json();
    const { token, service_id, professional_id, starts_at, customer_name, customer_phone } = body;

    if (!token || !service_id || !professional_id || !starts_at || !customer_name || !customer_phone) {
      return jsonResponse({ error: "missing_params" }, 400);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // Valida link
    const { data: link } = await supabase
      .from("public_booking_links")
      .select("tenant_id, active")
      .eq("token", token)
      .single();

    if (!link || !link.active) {
      return jsonResponse({ error: "invalid_link" }, 404);
    }

    // Busca serviço
    const { data: service } = await supabase
      .from("services")
      .select("*")
      .eq("id", service_id)
      .eq("tenant_id", link.tenant_id)
      .single();

    if (!service) {
      return jsonResponse({ error: "invalid_service" }, 400);
    }

    const startsAt = new Date(starts_at);
    const endsAt = new Date(startsAt.getTime() + service.duration_minutes * 60000);

    // Verifica conflito
    const { data: conflicts } = await supabase
      .from("appointments")
      .select("id")
      .eq("tenant_id", link.tenant_id)
      .eq("professional_id", professional_id)
      .neq("status", "cancelado")
      .lt("starts_at", endsAt.toISOString())
      .gt("ends_at", startsAt.toISOString());

    if (conflicts && conflicts.length > 0) {
      return jsonResponse({ error: "slot_unavailable" }, 409);
    }

    // Cria ou busca cliente
    let customerId: string;
    const { data: existingCustomer } = await supabase
      .from("customers")
      .select("id")
      .eq("tenant_id", link.tenant_id)
      .eq("phone", customer_phone)
      .single();

    if (existingCustomer) {
      customerId = existingCustomer.id;
    } else {
      const { data: newCustomer, error: custErr } = await supabase
        .from("customers")
        .insert({
          tenant_id: link.tenant_id,
          name: customer_name,
          phone: customer_phone,
        })
        .select("id")
        .single();

      if (custErr || !newCustomer) {
        console.error("public-book customer error", custErr);
        return jsonResponse({ error: "internal_error" }, 500);
      }
      customerId = newCustomer.id;
    }

    // Cria agendamento
    const { data: appointment, error: appErr } = await supabase
      .from("appointments")
      .insert({
        tenant_id: link.tenant_id,
        customer_id: customerId,
        professional_id: professional_id,
        service_id: service_id,
        starts_at: startsAt.toISOString(),
        ends_at: endsAt.toISOString(),
        price_cents: service.price_cents,
        status: "pendente",
      })
      .select("id, status")
      .single();

    if (appErr || !appointment) {
      console.error("public-book appointment error", appErr);
      return jsonResponse({ error: "internal_error" }, 500);
    }

    // Audit log
    await supabase.from("audit_log").insert({
      tenant_id: link.tenant_id,
      actor_id: null,
      action: "appointment_created_public",
      target_type: "appointment",
      target_id: appointment.id,
      metadata: { service_id, professional_id },
    });

    return jsonResponse({ success: true, appointment_id: appointment.id, status: appointment.status }, 201);
  } catch (e) {
    console.error("public-book exception", e);
    return jsonResponse({ error: "internal_error" }, 500);
  }
});
