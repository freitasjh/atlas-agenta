import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
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

  if (req.method !== "GET") {
    return jsonResponse({ error: "method_not_allowed" }, 405);
  }

  try {
    const url = new URL(req.url);
    const token = url.searchParams.get("token");
    const serviceId = url.searchParams.get("service_id");
    const professionalId = url.searchParams.get("professional_id");
    const date = url.searchParams.get("date");

    if (!token || !serviceId || !date) {
      return jsonResponse({ error: "missing_params" }, 400);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // Buscar dados do tenant/link
    const { data: link } = await supabase
      .from("public_booking_links")
      .select("tenant_id, active")
      .eq("token", token)
      .single();

    if (!link || !link.active) {
      return jsonResponse({ error: "invalid_link" }, 404);
    }

    // Buscar serviços e profissionais do tenant
    const [servicesRes, professionalsRes] = await Promise.all([
      supabase.from("services").select("*").eq("tenant_id", link.tenant_id).eq("active", true),
      supabase.from("professionals").select("*").eq("tenant_id", link.tenant_id).eq("active", true),
    ]);

    // Buscar slots disponíveis via RPC
    const { data: slots, error } = await supabase.rpc("public_booking_get_slots", {
      p_token: token,
      p_service_id: serviceId,
      p_professional_id: professionalId || null,
      p_date: date,
    });

    if (error) {
      console.error("public-slots error", error);
      return jsonResponse({ error: "internal_error" }, 500);
    }

    return jsonResponse({
      tenant_id: link.tenant_id,
      services: servicesRes.data || [],
      professionals: professionalsRes.data || [],
      slots: slots || [],
    });
  } catch (e) {
    console.error("public-slots exception", e);
    return jsonResponse({ error: "internal_error" }, 500);
  }
});
