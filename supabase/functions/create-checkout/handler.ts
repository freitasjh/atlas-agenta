// Checkout self-service do Meu plano (ADR-10, RF-37/RF-38).
//
// Só `admin` do tenant opera o plano; professional/recepção recebem 403
// (leem a base pelo `get_my_plan`, sem valores de fatura). Segredos (chave
// Asaas) só aqui no servidor — o cliente usa anon key e nunca os vê.
//
// Timing (resposta à pergunta 9 do PRD): upgrade aplica o plano
// imediatamente após a confirmação do webhook (`apply_subscription_payment`);
// downgrade agenda `scheduled_plan` com efeito no início do mês seguinte
// (`next_cycle_start_utc`). Downgrade para `free` (preço zero) não gera
// cobrança no gateway: agenda direto e liquida via RPC.
//
// Idempotência em duas camadas: `idempotency_key` do cliente (unique parcial,
// retry devolve a cobrança existente) + dedupe do webhook por evento.
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import {
  asaasBaseUrl,
  createPixCharge,
  ensureAsaasCustomer,
} from "../_shared/asaas.ts";
import { requestSchema } from "./schemas.ts";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

interface Identity {
  userId: string;
  tenantId: string;
}

async function resolveIdentity(
  req: Request,
  service: SupabaseClient,
): Promise<
  | { ok: true; identity: Identity }
  | { ok: false; status: 401 | 403; error: string }
> {
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return { ok: false, status: 401, error: "Sessão inválida ou expirada." };
  const { data, error } = await service.auth.getUser(token);
  if (error || !data.user) return { ok: false, status: 401, error: "Sessão inválida ou expirada." };
  const { data: profile } = await service
    .from("profiles")
    .select("tenant_id, role")
    .eq("id", data.user.id)
    .maybeSingle();
  if (!profile || profile.role !== "admin" || !profile.tenant_id) {
    return { ok: false, status: 403, error: "Sem permissão para gerenciar o plano." };
  }
  return { ok: true, identity: { userId: data.user.id, tenantId: profile.tenant_id } };
}

const PLAN_RANK: Record<string, number> = {
  free: 0,
  starter: 1,
  premium: 2,
  enterprise: 3,
};

function planRank(plan: string): number {
  return PLAN_RANK[plan] ?? -1;
}

function tzOffsetMs(timezone: string, date: Date): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).formatToParts(date).map((p) => [p.type, p.value]),
  );
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return asUtc - date.getTime();
}

function zonedMonthStartUtc(timezone: string, year: number, month: number): Date {
  const wall = Date.UTC(year, month - 1, 1, 0, 0, 0);
  let guess = wall;
  for (let i = 0; i < 3; i++) guess = wall - tzOffsetMs(timezone, new Date(guess));
  return new Date(guess);
}

/**
 * Limites UTC [start, end) do mês vigente no fuso do tenant.
 * O `appt_limit` dos planos é mensal (mesmo critério do trigger
 * `enforce_appointment_plan_limit` e do `tenant_plan_usage`): a contagem do
 * fail-fast do downgrade usa `gte(start)/lt(end)` sobre `starts_at`, nunca
 * contagem all-time. `now` injetável para testes determinísticos.
 */
export function currentMonthBoundsUtc(
  timezone: string,
  now: Date = new Date(),
): { start: string; end: string } {
  const tz = timezone || "America/Sao_Paulo";
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "2-digit" })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  const year = Number(parts.year);
  const month = Number(parts.month);
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  return {
    start: zonedMonthStartUtc(tz, year, month).toISOString(),
    end: zonedMonthStartUtc(tz, nextYear, nextMonth).toISOString(),
  };
}

export type HandlerOptions = { createService: () => SupabaseClient };

export function createHandler(options: HandlerOptions) {
  return async (req: Request): Promise<Response> => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
    if (req.method !== "POST") return jsonResponse({ error: "Método não suportado." }, 405);

    let service: SupabaseClient;
    try {
      service = options.createService();
    } catch {
      return jsonResponse({ error: "Erro de configuração do servidor." }, 500);
    }

    const identity = await resolveIdentity(req, service);
    if (!identity.ok) return jsonResponse({ error: identity.error }, identity.status);
    const { tenantId } = identity.identity;

    let raw: unknown;
    try {
      raw = await req.json();
    } catch {
      return jsonResponse({ error: "Corpo inválido." }, 400);
    }
    const parsed = requestSchema.safeParse(raw);
    if (!parsed.success) return jsonResponse({ error: "Dados inválidos." }, 400);
    const input = parsed.data;

    // Retry seguro: mesma chave devolve a cobrança existente.
    if (input.idempotency_key) {
      const { data: existing, error: lookupErr } = await service
        .from("subscription_charges")
        .select("id, status, amount_cents, plan, kind, pix_qr_code, pix_copy_paste, expires_at, effective_at")
        .eq("tenant_id", tenantId)
        .eq("idempotency_key", input.idempotency_key)
        .maybeSingle();
      if (lookupErr) return jsonResponse({ error: "Falha ao verificar a cobrança." }, 500);
      if (existing) {
        return jsonResponse(
          {
            charge_id: existing.id,
            kind: existing.kind,
            pix_qr_code: existing.pix_qr_code,
            pix_copy_paste: existing.pix_copy_paste,
            expires_at: existing.expires_at,
            effective_at: existing.effective_at,
            idempotency_key: input.idempotency_key,
            replayed: true,
          },
          200,
        );
      }
    }

    const { data: tenant } = await service
      .from("tenants")
      .select("plan, subscription_status, timezone, trade_name, owner_email")
      .eq("id", tenantId)
      .maybeSingle();
    if (!tenant) return jsonResponse({ error: "Empresa não encontrada." }, 404);
    if (tenant.subscription_status === "cancelado") {
      return jsonResponse({ error: "Assinatura cancelada. Fale com o suporte.", code: "SUBSCRIPTION_CANCELLED" }, 403);
    }

    const { data: targetPlan, error: planErr } = await service
      .from("plans")
      .select("slug, price_cents, features")
      .eq("slug", input.plan)
      .eq("active", true)
      .maybeSingle();
    if (planErr || !targetPlan) return jsonResponse({ error: "Plano inválido." }, 400);

    if (input.plan === tenant.plan) {
      return jsonResponse({ error: "Este já é o plano atual.", code: "ALREADY_ON_PLAN" }, 400);
    }

    // Gating (RF-38): sem a chave no plano vigente, checkout indisponível + upsell.
    const { data: currentPlan } = await service
      .from("plans")
      .select("features")
      .eq("slug", tenant.plan)
      .maybeSingle();
    const features = Array.isArray(currentPlan?.features) ? currentPlan.features : [];
    if (!features.includes("checkout_self_service")) {
      return jsonResponse(
        { error: "Checkout indisponível no plano atual.", code: "UPSELL", upsell: true },
        403,
      );
    }

    const oldRank = planRank(tenant.plan);
    const newRank = planRank(input.plan);
    if (oldRank < 0 || newRank < 0) return jsonResponse({ error: "Plano inválido." }, 400);
    const kind = newRank > oldRank ? "upgrade" : "downgrade";

    // Fail-fast no downgrade: uso acima do limite do destino é 409 agora
    // (o `apply_due_scheduled_plans` repete a checagem na efetivação).
    // Agendamentos contam só o mês vigente no fuso do tenant (gte/lt sobre
    // starts_at com boundaries em UTC) — appt_limit é mensal, contagem
    // all-time barraria downgrade legítimo com histórico antigo.
    let effectiveAt: string | null = null;
    if (kind === "downgrade") {
      const { data: eff, error: effErr } = await service.rpc("next_cycle_start_utc", {
        p_tenant_id: tenantId,
      });
      if (effErr || !eff) return jsonResponse({ error: "Falha ao calcular a vigência." }, 500);
      effectiveAt = eff as string;

      const { start: monthStart, end: monthEnd } = currentMonthBoundsUtc(
        tenant.timezone ?? "America/Sao_Paulo",
      );
      const [{ count: profCount }, { count: apptCount }] = await Promise.all([
        service.from("professionals").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("active", true),
        service.from("appointments").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).neq("status", "cancelado").gte("starts_at", monthStart).lt("starts_at", monthEnd),
      ]);
      const profLimit = await service.rpc("plan_professional_limit", { p_plan: input.plan });
      const apptLimit = await service.rpc("plan_appointment_limit", { p_plan: input.plan });
      const vProfLimit = typeof profLimit.data === "number" ? profLimit.data : null;
      const vApptLimit = typeof apptLimit.data === "number" ? apptLimit.data : null;
      if (
        (vProfLimit !== null && (profCount ?? 0) > vProfLimit) ||
        (vApptLimit !== null && (apptCount ?? 0) > vApptLimit)
      ) {
        return jsonResponse(
          { error: "Uso atual acima do limite do plano de destino.", code: "PLAN_LIMIT" },
          409,
        );
      }
    }

    // Downgrade para plano de preço zero: sem cobrança no gateway, agenda direto.
    // Decisão ADR-10 (A2, intencional): free = sem cobrança, então a troca
    // agenda e liquida via RPC sem passar pelo Asaas. O
    // `apply_subscription_payment` reativa `bloqueado` -> `ativo` nesse fluxo
    // porque preço zero não deixa débito em aberto (quitação implícita, sem
    // meio de pagamento a cobrar). Downgrade para plano pago com pendência
    // continua exigindo quitação via cobrança PIX.
    if (targetPlan.price_cents === 0) {
      if (kind !== "downgrade") return jsonResponse({ error: "Plano inválido para cobrança." }, 400);
      const { data: charge, error: insErr } = await service
        .from("subscription_charges")
        .insert({
          tenant_id: tenantId,
          status: "pendente",
          amount_cents: 0,
          plan: input.plan,
          kind,
          billing_period: "monthly",
          effective_at: effectiveAt,
          idempotency_key: input.idempotency_key ?? null,
        })
        .select("id")
        .single();
      if (insErr) {
        if ((insErr as { code?: string }).code === "23505" && input.idempotency_key) {
          const { data: dup } = await service
            .from("subscription_charges")
            .select("id, status, kind, expires_at, effective_at")
            .eq("tenant_id", tenantId)
            .eq("idempotency_key", input.idempotency_key)
            .maybeSingle();
          if (dup) {
            return jsonResponse({ charge_id: dup.id, kind: dup.kind, effective_at: dup.effective_at, idempotency_key: input.idempotency_key, replayed: true }, 200);
          }
        }
        return jsonResponse({ error: "Falha ao registrar o agendamento." }, 500);
      }
      const { error: rpcErr } = await service.rpc("apply_subscription_payment", { p_charge_id: charge.id });
      if (rpcErr) return jsonResponse({ error: "Falha ao agendar a troca de plano." }, 500);
      await service.from("audit_log").insert({
        tenant_id: tenantId,
        actor_id: identity.identity.userId,
        action: "subscription_checkout_created",
        target_type: "subscription_charge",
        target_id: charge.id,
        metadata: { plan: input.plan, kind, amount_cents: 0 },
      });
      return jsonResponse(
        { charge_id: charge.id, kind, effective_at: effectiveAt, idempotency_key: input.idempotency_key ?? null, scheduled: true },
        200,
      );
    }

    const apiKey = Deno.env.get("ASAAS_SUPER_ADMIN_API_KEY");
    if (!apiKey) return jsonResponse({ error: "Cobrança indisponível no momento." }, 500);
    const env = Deno.env.get("ASAAS_SUPER_ADMIN_ENVIRONMENT");
    if (env !== "sandbox" && env !== "production") {
      return jsonResponse({ error: "Cobrança indisponível no momento." }, 500);
    }
    const baseUrl = asaasBaseUrl(env);

    const customerId = await ensureAsaasCustomer(baseUrl, apiKey, {
      customerId: tenantId,
      name: tenant.trade_name ?? "Tenant",
      email: tenant.owner_email ?? null,
    });
    if (!customerId) return jsonResponse({ error: "Falha ao identificar o cliente." }, 500);

    const expiresAt = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
    const pix = await createPixCharge(baseUrl, apiKey, {
      customerId,
      amountCents: targetPlan.price_cents,
      externalReference: tenantId,
      expiresAt,
      description: `Assinatura ${input.plan} (${kind})`,
    });
    if (!pix.ok || !pix.paymentId) return jsonResponse({ error: "Falha ao criar a cobrança." }, 500);

    const { data: charge, error: insErr } = await service
      .from("subscription_charges")
      .insert({
        tenant_id: tenantId,
        asaas_payment_id: pix.paymentId,
        status: "pendente",
        amount_cents: targetPlan.price_cents,
        plan: input.plan,
        kind,
        billing_period: "monthly",
        pix_qr_code: pix.pixQrCode,
        pix_copy_paste: pix.pixCopyPaste,
        expires_at: expiresAt,
        effective_at: effectiveAt,
        idempotency_key: input.idempotency_key ?? null,
      })
      .select("id")
      .single();
    if (insErr) {
      if ((insErr as { code?: string }).code === "23505" && input.idempotency_key) {
        const { data: dup } = await service
          .from("subscription_charges")
          .select("id, status, kind, pix_qr_code, pix_copy_paste, expires_at, effective_at")
          .eq("tenant_id", tenantId)
          .eq("idempotency_key", input.idempotency_key)
          .maybeSingle();
        if (dup) {
          return jsonResponse(
            {
              charge_id: dup.id, kind: dup.kind, pix_qr_code: dup.pix_qr_code,
              pix_copy_paste: dup.pix_copy_paste, expires_at: dup.expires_at,
              effective_at: dup.effective_at, idempotency_key: input.idempotency_key, replayed: true,
            },
            200,
          );
        }
      }
      return jsonResponse({ error: "Falha ao salvar a cobrança." }, 500);
    }

    const { error: auditErr } = await service.from("audit_log").insert({
      tenant_id: tenantId,
      actor_id: identity.identity.userId,
      action: "subscription_checkout_created",
      target_type: "subscription_charge",
      target_id: charge.id,
      metadata: { plan: input.plan, kind, amount_cents: targetPlan.price_cents },
    });
    if (auditErr) return jsonResponse({ error: "Falha ao registrar auditoria." }, 500);

    return jsonResponse(
      {
        charge_id: charge.id,
        kind,
        pix_qr_code: pix.pixQrCode,
        pix_copy_paste: pix.pixCopyPaste,
        expires_at: expiresAt,
        effective_at: effectiveAt,
        idempotency_key: input.idempotency_key ?? null,
      },
      200,
    );
  };
}
