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

    // Cria agendamento (Fase 4, ADR-03: serviço com depósito abre
    // `aguardando_deposito` com prazo; legado segue `pendente`).
    const depositEnabled = service.deposit_enabled === true;
    const deadlineHours =
      typeof service.deposit_deadline_hours === "number" &&
      service.deposit_deadline_hours > 0
        ? service.deposit_deadline_hours
        : 24;
    const appointmentStatus = depositEnabled ? "aguardando_deposito" : "pendente";
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
        status: appointmentStatus,
        ...(depositEnabled
          ? {
              deposit_deadline_at: new Date(
                Date.now() + deadlineHours * 3600 * 1000,
              ).toISOString(),
            }
          : {}),
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

    // Serviço sem depósito: fluxo legado (sem charge).
    if (!depositEnabled) {
      return jsonResponse({ success: true, appointment_id: appointment.id, status: appointment.status }, 201);
    }

    // Serviço com depósito: calcula o sinal e abre a cobrança `deposito`
    // pendente (idempotente por índice parcial). Sem gateway nesta fase: o QR
    // é preenchido pela rotina de emissão; o front exibe o passo PIX com
    // loading/erro até lá (DepositStep).
    let depositAmount = 0;
    if (service.deposit_type === "percent") {
      depositAmount = Math.round(
        (service.price_cents * service.deposit_value) / 100,
      );
    } else {
      depositAmount =
        service.deposit_value > 0 ? service.deposit_value : service.price_cents;
    }
    if (depositAmount <= 0) depositAmount = service.price_cents;
    const deadline = new Date(Date.now() + deadlineHours * 3600 * 1000);

    let chargeId: string | null = null;
    const { data: existingCharge } = await supabase
      .from("charges")
      .select("id")
      .eq("tenant_id", link.tenant_id)
      .eq("appointment_id", appointment.id)
      .eq("status", "pendente")
      .eq("charge_type", "deposito")
      .maybeSingle();
    if (existingCharge) {
      chargeId = existingCharge.id;
    } else {
      const { data: charge, error: chargeErr } = await supabase
        .from("charges")
        .insert({
          tenant_id: link.tenant_id,
          appointment_id: appointment.id,
          status: "pendente",
          amount_cents: depositAmount,
          charge_type: "deposito",
          expires_at: deadline.toISOString(),
        })
        .select("id")
        .single();
      if (chargeErr || !charge) {
        console.error("public-book deposit charge error", chargeErr);
        return jsonResponse({ error: "internal_error" }, 500);
      }
      chargeId = charge.id;
    }

    return jsonResponse({
      success: true,
      appointment_id: appointment.id,
      status: appointment.status,
      charge: {
        id: chargeId,
        status: "pendente",
        amount_cents: depositAmount,
        expires_at: deadline.toISOString(),
        pix_qr_code: null,
        pix_copia_e_cola: null,
      },
    }, 201);
  } catch (e) {
    console.error("public-book exception", e);
    return jsonResponse({ error: "internal_error" }, 500);
  }
});
