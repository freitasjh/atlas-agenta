// Webhook do Asaas — consumidor idempotente do ciclo de vida da cobrança PIX.
//
// Ordem normativa (SPEC ADR-003 §3.2):
//   OPTIONS/405 → createService → token presente → JSON+zod → payment.id?
//   → lookup da cobrança → token do tenant (fallback global) → dedupe insert
//   → dispatch → processed_at=now() → log → 200.
//
// Regras de ouro: nunca `update charges set status='pago'`; liquidação só por
// `settle_charge_payment`; `pago` nunca é rebaixado; falha deixa `processed_at` nulo.
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { centsFromGatewayValue, parseGatewayDate } from "../_shared/asaas.ts";
import { logEvent } from "../_shared/http.ts";
import { isAuthorized, resolveExpectedToken } from "./auth.ts";
import { beginEvent, finishEvent } from "./dedupe.ts";
import { classifyAsaasEvent } from "./events.ts";
import { payloadSchema, type PaymentPayload } from "./schemas.ts";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, asaas-access-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const INTERNAL_ERROR = { error: "Erro ao processar o evento." };

export interface HandlerOptions {
  createService: () => SupabaseClient;
}

interface ChargeRow {
  id: string;
  tenant_id: string;
  status: string;
  amount_cents: number;
  appointment_id: string | null;
}

interface SettleResult {
  anomaly?: string | null;
  replayed?: boolean;
  charge_status?: string;
}

interface AuditEntry {
  tenantId: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  metadata: Record<string, unknown>;
}

/** Nomes de evento conhecidos; qualquer outro vira `outro` no log (nunca ecoa payload). */
const KNOWN_EVENTS = new Set([
  "PAYMENT_RECEIVED",
  "PAYMENT_CONFIRMED",
  "PAYMENT_OVERDUE",
  "PAYMENT_DELETED",
  "PAYMENT_REFUNDED",
  "PAYMENT_PARTIALLY_REFUNDED",
  "PAYMENT_CHARGEBACK_REQUESTED",
  "PAYMENT_CHARGEBACK_DISPUTE",
  "PAYMENT_AWAITING_CHARGEBACK_REVERSAL",
]);

function safeEventType(event: string): string {
  const normalized = event.trim().toUpperCase();
  return KNOWN_EVENTS.has(normalized) ? normalized : "outro";
}

async function writeAudit(service: SupabaseClient, entry: AuditEntry): Promise<void> {
  const { error } = await service.from("audit_log").insert({
    tenant_id: entry.tenantId,
    action: entry.action,
    target_type: entry.targetType,
    target_id: entry.targetId,
    metadata: entry.metadata,
  });
  if (error) throw error;
}

function eventMetadata(
  eventId: string,
  eventType: string,
  charge: ChargeRow,
  payment: PaymentPayload,
): Record<string, unknown> {
  return {
    event_id: eventId,
    event_type: eventType,
    charge_id: charge.id,
    payment_id: payment.id,
    amount_cents: charge.amount_cents,
  };
}

async function dispatchSettle(
  service: SupabaseClient,
  charge: ChargeRow,
  payment: PaymentPayload,
  eventId: string,
  eventType: string,
): Promise<{ status: string; code?: string }> {
  const paidAt =
    parseGatewayDate(payment.paymentDate) ?? parseGatewayDate(payment.confirmedDate) ?? null;

  const { data, error } = await service.rpc("settle_charge_payment", {
    p_tenant_id: charge.tenant_id,
    p_charge_id: charge.id,
    p_paid_at: paidAt,
    p_source: "asaas",
    p_actor_id: null,
    p_event_id: eventId,
  });

  if (error) {
    // Cobrança sem atendimento é anomalia de negócio: 200, sem receita e sem retry infinito.
    if (error.code === "PT409" && error.message === "CHARGE_NOT_APPOINTMENT") {
      return { status: charge.status, code: "CHARGE_NOT_APPOINTMENT" };
    }
    throw error;
  }

  const result = (data ?? {}) as SettleResult;

  // Divergência de valor é auditoria, não receita: liquidação sempre usa `charges.amount_cents`.
  // Anomalia do `settle` já foi auditada pela RPC; não duplicar.
  if (!result.anomaly) {
    const paymentValueCents = centsFromGatewayValue(payment.value);
    if (paymentValueCents !== null && paymentValueCents !== charge.amount_cents) {
      await writeAudit(service, {
        tenantId: charge.tenant_id,
        action: "payment_amount_mismatch",
        targetType: "charge",
        targetId: charge.id,
        metadata: {
          event_id: eventId,
          event_type: eventType,
          charge_id: charge.id,
          amount_cents: charge.amount_cents,
          payment_value_cents: paymentValueCents,
        },
      });
    }
  }

  return { status: result.charge_status ?? "pago" };
}

/** Auditoria já gravada para este `event_id`? Torna o retry de transição idempotente.
 *
 * Leitura por `limit(1)`: o filtro não tem constraint única, então auditorias
 * duplicadas (takeover concorrente) são possíveis. `maybeSingle` falharia com
 * 2 linhas e o evento ficaria pendente para sempre.
 */
async function hasAuditForEvent(
  service: SupabaseClient,
  action: string,
  chargeId: string,
  eventId: string,
): Promise<boolean> {
  const { data, error } = await service
    .from("audit_log")
    .select("id")
    .eq("action", action)
    .eq("target_type", "charge")
    .eq("target_id", chargeId)
    .eq("metadata->>event_id", eventId)
    .limit(1);
  if (error) throw error;
  return Array.isArray(data) && data.length > 0;
}

/** Overdue/deleted só a partir de `pendente`; `pago` é terminal e nunca recebe update. */
async function dispatchTransition(
  service: SupabaseClient,
  charge: ChargeRow,
  payment: PaymentPayload,
  eventId: string,
  eventType: string,
  target: "expirado" | "cancelado",
  action: "charge_expired" | "charge_deleted_gateway",
): Promise<{ status: string }> {
  const alreadyApplied = charge.status === target;
  // `pago` (e qualquer estado fora de `pendente`) nunca é rebaixado.
  if (!alreadyApplied && charge.status !== "pendente") return { status: charge.status };

  if (!alreadyApplied) {
    const { data, error } = await service
      .from("charges")
      .update({ status: target })
      .eq("tenant_id", charge.tenant_id)
      .eq("id", charge.id)
      .eq("status", "pendente")
      .select("id");
    if (error) throw error;

    const updated = Array.isArray(data) && data.length > 0;
    if (!updated) return { status: charge.status };
  }

  // Retry: a entrega anterior pode ter aplicado o status e falhado antes da auditoria.
  // O efeito não se repete; grava-se apenas a auditoria que faltou, uma vez por `event_id`.
  if (!(await hasAuditForEvent(service, action, charge.id, eventId))) {
    await writeAudit(service, {
      tenantId: charge.tenant_id,
      action,
      targetType: "charge",
      targetId: charge.id,
      metadata: eventMetadata(eventId, eventType, charge, payment),
    });
  }
  return { status: alreadyApplied ? charge.status : target };
}

async function dispatchRefund(
  service: SupabaseClient,
  charge: ChargeRow,
  payment: PaymentPayload,
  eventId: string,
  eventType: string,
): Promise<{ status: string }> {
  await writeAudit(service, {
    tenantId: charge.tenant_id,
    action: "gateway_refund_out_of_scope",
    targetType: "charge",
    targetId: charge.id,
    metadata: eventMetadata(eventId, eventType, charge, payment),
  });
  return { status: charge.status };
}

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

    const headerToken = (req.headers.get("asaas-access-token") ?? "").trim();
    if (!headerToken) return jsonResponse({ error: "Token ausente." }, 401);

    let raw: unknown;
    try {
      raw = JSON.parse(await req.text());
    } catch {
      return jsonResponse({ error: "Corpo inválido." }, 400);
    }

    const parsed = payloadSchema.safeParse(raw);
    if (!parsed.success) return jsonResponse({ error: "Dados inválidos." }, 400);
    const payload = parsed.data;

    // Evento não financeiro: no-op antes de qualquer lookup/dedupe.
    if (!payload.payment) return jsonResponse({ ok: true }, 200);
    const payment = payload.payment;
    const eventType = safeEventType(payload.event);

    const { data: charge, error: lookupError } = await service
      .from("charges")
      .select("id, tenant_id, status, amount_cents, appointment_id")
      .eq("asaas_payment_id", payment.id)
      .maybeSingle();
    if (lookupError) return jsonResponse(INTERNAL_ERROR, 500);

    let expectedToken: string | null;
    try {
      expectedToken = await resolveExpectedToken(service, charge as ChargeRow | null);
    } catch {
      return jsonResponse(INTERNAL_ERROR, 500);
    }
    if (!isAuthorized(headerToken, expectedToken)) {
      return jsonResponse({ error: "Token inválido." }, 401);
    }

    // Cobrança desconhecida não entra em `webhook_events` (tenant_id not null):
    // o 200 + auditoria é a evidência, e `externalReference` nunca localiza cobrança.
    if (!charge) {
      try {
        const metadata: Record<string, unknown> = {
          payment_id: payment.id,
          event_type: eventType,
        };
        const reported = payment.externalReference;
        if (typeof reported === "string" && reported.trim() !== "") {
          metadata.reported_external_reference = reported.trim();
        }
        await writeAudit(service, {
          tenantId: null,
          action: "charge_unknown_webhook",
          targetType: "charge",
          targetId: null,
          metadata,
        });
      } catch {
        return jsonResponse(INTERNAL_ERROR, 500);
      }
      logEvent("asaas_webhook", {
        event_id: payload.id,
        event_type: eventType,
        status: "unknown",
        code: "CHARGE_UNKNOWN",
      });
      return jsonResponse({ ok: true }, 200);
    }

    const chargeRow = charge as ChargeRow;

    let begin: "process" | "already_processed";
    try {
      begin = await beginEvent(service, {
        tenantId: chargeRow.tenant_id,
        eventId: payload.id,
        paymentId: payment.id,
        eventType: payload.event,
      });
    } catch {
      return jsonResponse(INTERNAL_ERROR, 500);
    }

    if (begin === "already_processed") {
      logEvent("asaas_webhook", {
        event_id: payload.id,
        event_type: eventType,
        tenant_id: chargeRow.tenant_id,
        charge_id: chargeRow.id,
        status: chargeRow.status,
        code: "DUPLICATE",
      });
      return jsonResponse({ ok: true }, 200);
    }

    const kind = classifyAsaasEvent(payload.event);
    let statusAfter = chargeRow.status;
    let code: string | undefined;

    try {
      if (kind === "settle") {
        const result = await dispatchSettle(
          service,
          chargeRow,
          payment,
          payload.id,
          eventType,
        );
        statusAfter = result.status;
        code = result.code;
      } else if (kind === "overdue") {
        const result = await dispatchTransition(
          service,
          chargeRow,
          payment,
          payload.id,
          eventType,
          "expirado",
          "charge_expired",
        );
        statusAfter = result.status;
      } else if (kind === "deleted") {
        const result = await dispatchTransition(
          service,
          chargeRow,
          payment,
          payload.id,
          eventType,
          "cancelado",
          "charge_deleted_gateway",
        );
        statusAfter = result.status;
      } else if (kind === "refund") {
        const result = await dispatchRefund(
          service,
          chargeRow,
          payment,
          payload.id,
          eventType,
        );
        statusAfter = result.status;
      }
      // `ignore`: nenhum efeito, mas o evento é marcado como processado abaixo.
    } catch {
      return jsonResponse(INTERNAL_ERROR, 500);
    }

    try {
      await finishEvent(service, payload.id, payment.id);
    } catch {
      return jsonResponse(INTERNAL_ERROR, 500);
    }

    logEvent("asaas_webhook", {
      event_id: payload.id,
      event_type: eventType,
      tenant_id: chargeRow.tenant_id,
      charge_id: chargeRow.id,
      status: statusAfter,
      code,
    });
    return jsonResponse({ ok: true }, 200);
  };
}
