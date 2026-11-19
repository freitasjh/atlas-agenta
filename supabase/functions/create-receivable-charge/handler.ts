// Cobrança PIX de conta a RECEBER avulsa (Fase 5 ADR-07; RF-19/RF-21).
//
// Fronteira (ADR-07): avulsa NUNCA entra no ledger `appointment_payments`. Esta
// função só cria/reaproveita a cobrança do gateway em `receivables` e, quando
// pedido e o cliente consentiu, enfileira a mensagem de cobrança no WhatsApp.
//
// Idempotência (RF-40): a conta guarda UM `asaas_payment_id` (unique parcial por
// tenant) e a criação é serializada pelo claim de `receivables`
// (`claim_receivable_gateway`, ver `_shared/gateway-claim.ts`). Quem ganha o claim
// é o único que pode fazer `POST /payments`; quem perde espera os dados do
// vencedor e reapresenta a MESMA cobrança. Nenhum caminho cancela o PIX do
// vencedor: um órfão só é derrubado quando o id dele difere do gravado na conta.
//
// Expiração: `charge_expires_at` no passado ⇒ o PIX antigo é cancelado no gateway
// e a conta é reemitida (claim novo + novo QR). Se o gateway recusar o
// cancelamento, a resposta é 422 `GATEWAY_CANCEL_FAILED` — nunca um segundo PIX
// vivo em silêncio.
//
// Opt-in (LGPD): `notify_whatsapp` sem `customers.whatsapp_opt_in` ⇒ 422
// `WHATSAPP_OPT_IN_REQUIRED` ANTES de qualquer chamada ao gateway ou à fila.
// A mensagem nasce em `messages.status='fila'` com template `cobranca` (texto
// padrão do sistema) e dedupe por conta — a drenadora existente
// (`whatsapp-dispatch`) faz o envio físico e reaplica opt-in/instância.
//
// Cobrança só para conta `pendente`: depois de um recebimento parcial o saldo
// pode ser menor que o PIX emitido; emitir PIX sobre saldo novo exigiria
// cancelar o anterior, então a UI oferece apenas "Registrar recebimento" nesse
// estado (decisão declarada, evita overpay de PIX).

import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import {
  asaasBaseUrl,
  cancelPayment,
  createPixCharge,
  decryptText,
  ensureAsaasCustomer,
  findPaymentByExternalReference,
} from "../_shared/asaas.ts";
import {
  acquireGatewayClaim,
  asChargeState,
  GATEWAY_CLAIM_TTL_SECONDS,
  type ChargeState,
  type GatewayClaimAdapter,
} from "../_shared/gateway-claim.ts";
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

const CHARGE_TTL_MS = 3 * 86_400_000;

interface ReceivableRow {
  id: string;
  customer_id: string;
  descricao: string;
  valor_cents: number;
  status: string;
  asaas_payment_id: string | null;
  pix_qr_code: string | null;
  pix_copy_paste: string | null;
  charge_expires_at: string | null;
}

interface GatewayConfig {
  baseUrl: string;
  apiKey: string;
}

interface WhatsappOutcome {
  requested: boolean;
  queued: boolean;
  message_id: string | null;
}

interface GatewayPayment {
  paymentId: string;
  pixQrCode: string | null;
  pixCopyPaste: string | null;
}

const RECEIVABLE_SELECT =
  "id, customer_id, descricao, valor_cents, status, asaas_payment_id, pix_qr_code, pix_copy_paste, charge_expires_at";

function successBody(
  receivable: ReceivableRow,
  amountCents: number,
  reused: boolean,
  whatsapp: WhatsappOutcome,
): Record<string, unknown> {
  return {
    receivable_id: receivable.id,
    status: receivable.status,
    amount_cents: amountCents,
    pix_qr_code: receivable.pix_qr_code ?? null,
    pix_copy_paste: receivable.pix_copy_paste ?? null,
    expires_at: receivable.charge_expires_at ?? null,
    reused,
    whatsapp,
  };
}

/** PIX vencido: precisa ser cancelado e reemitido, nunca reapresentado. */
function chargeExpired(receivable: ReceivableRow, now: Date): boolean {
  if (!receivable.charge_expires_at) return false;
  const expires = new Date(receivable.charge_expires_at);
  if (Number.isNaN(expires.getTime())) return false;
  return expires.getTime() <= now.getTime();
}

/** PIX vivo e ainda válido: a reposta é a própria cobrança existente. */
function chargeReusable(receivable: ReceivableRow, now: Date): boolean {
  return (
    receivable.asaas_payment_id !== null &&
    receivable.pix_copy_paste !== null &&
    !chargeExpired(receivable, now)
  );
}

function toChargeState(receivable: ReceivableRow): ChargeState {
  return asChargeState({
    charge_id: receivable.id,
    amount_cents: receivable.valor_cents,
    status: receivable.status,
    asaas_payment_id: receivable.asaas_payment_id,
    pix_qr_code: receivable.pix_qr_code,
    pix_copy_paste: receivable.pix_copy_paste,
    expires_at: receivable.charge_expires_at,
  });
}

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
      const identity = await resolveIdentity(req, service, ["admin"]);

      let raw: unknown;
      try {
        raw = await req.json();
      } catch {
        throw new ApiError(400, "INVALID_BODY");
      }
      const parsed = requestSchema.safeParse(raw);
      if (!parsed.success) throw new ApiError(400, "INVALID_BODY");
      const body = parsed.data;

      const receivable = await loadReceivable(service, identity.tenantId, body.receivable_id);
      if (receivable.status === "pago") throw new ApiError(409, "RECEIVABLE_ALREADY_PAID");
      if (receivable.status === "cancelado") throw new ApiError(409, "RECEIVABLE_CANCELLED");
      if (receivable.status !== "pendente") {
        throw new ApiError(409, "RECEIVABLE_CHARGE_NOT_PENDING");
      }

      if (body.notify_whatsapp === true) {
        await assertWhatsappOptIn(service, identity.tenantId, receivable.customer_id);
      }

      // Reuso: conta já tem PIX vivo e dentro da validade; devolve sem tocar o gateway.
      if (chargeReusable(receivable, new Date())) {
        const whatsapp = await maybeQueueWhatsapp(
          service,
          identity.tenantId,
          receivable,
          body.notify_whatsapp === true,
        );
        logEvent("receivable_charge_reused", {
          tenant_id: identity.tenantId,
          actor_id: identity.userId,
          receivable_id: receivable.id,
          amount_cents: receivable.valor_cents,
          replayed: true,
        });
        return jsonResponse(successBody(receivable, receivable.valor_cents, true, whatsapp), 200);
      }

      const config = await loadGatewayConfig(service, identity.tenantId);
      if (!config) throw new ApiError(422, "ASAAS_NOT_CONFIGURED");

      const customer = await loadCustomer(service, identity.tenantId, receivable.customer_id);
      const asaasCustomerId = await ensureAsaasCustomer(config.baseUrl, config.apiKey, {
        customerId: receivable.customer_id,
        name: customer.name,
        email: customer.email,
        phone: customer.phone,
      });
      if (!asaasCustomerId) throw new ApiError(422, "GATEWAY_ERROR");

      const outcome = await acquireGatewayClaim(
        receivableClaimAdapter(service, identity.tenantId, receivable.id),
      );

      if (outcome.handle === "reused") {
        const winner = await loadReceivable(service, identity.tenantId, receivable.id);
        const whatsapp = await maybeQueueWhatsapp(
          service,
          identity.tenantId,
          winner,
          body.notify_whatsapp === true,
        );
        logEvent("receivable_charge_race_lost", {
          tenant_id: identity.tenantId,
          actor_id: identity.userId,
          receivable_id: receivable.id,
          code: "GATEWAY_CLAIM_LOST",
        });
        return jsonResponse(successBody(winner, winner.valor_cents, true, whatsapp), 200);
      }

      const claimToken = outcome.claimToken;
      let claimed: { receivable: ReceivableRow; reused: boolean };
      try {
        claimed = await createUnderClaim({
          service,
          tenantId: identity.tenantId,
          config,
          receivableId: receivable.id,
          asaasCustomerId,
          claimToken,
        });
      } finally {
        await releaseClaim(service, identity.tenantId, receivable.id, claimToken);
      }

      if (claimed.reused) {
        const whatsapp = await maybeQueueWhatsapp(
          service,
          identity.tenantId,
          claimed.receivable,
          body.notify_whatsapp === true,
        );
        return jsonResponse(
          successBody(claimed.receivable, claimed.receivable.valor_cents, true, whatsapp),
          200,
        );
      }

      const attached = claimed.receivable;

      const whatsapp = await maybeQueueWhatsapp(
        service,
        identity.tenantId,
        attached,
        body.notify_whatsapp === true,
      );

      logEvent("receivable_charge_created", {
        tenant_id: identity.tenantId,
        actor_id: identity.userId,
        receivable_id: attached.id,
        amount_cents: attached.valor_cents,
        replayed: false,
      });
      return jsonResponse(successBody(attached, attached.valor_cents, false, whatsapp), 200);
    } catch (error) {
      return errorResponse(error);
    }
  };
}

/**
 * Executa a criação/reemissão sob o claim. Devolve a linha final e se a resposta
 * deve ser tratada como reuso (outra invocação anexou o PIX).
 */
async function createUnderClaim(args: {
  service: SupabaseClient;
  tenantId: string;
  config: GatewayConfig;
  receivableId: string;
  asaasCustomerId: string;
  claimToken: string;
}): Promise<{ receivable: ReceivableRow; reused: boolean }> {
  const { service, tenantId, config, receivableId, claimToken } = args;
  const current = await loadReceivable(service, tenantId, receivableId);

  // PIX vencido precisa morrer no gateway antes da reemissão.
  let cancelledPaymentId: string | null = null;
  if (current.asaas_payment_id !== null && chargeExpired(current, new Date())) {
    const cancelled = await cancelPayment(config.baseUrl, config.apiKey, current.asaas_payment_id);
    if (!cancelled.ok && !cancelled.notFound) {
      throw new ApiError(422, "GATEWAY_CANCEL_FAILED");
    }
    await clearExpiredGatewayData(service, tenantId, current.id, current.asaas_payment_id);
    cancelledPaymentId = current.asaas_payment_id;
  }

  const payment = await obtainGatewayPayment(
    config,
    receivableId,
    cancelledPaymentId === null ? current.asaas_payment_id : null,
    args.asaasCustomerId,
    current.valor_cents,
    current.descricao,
    cancelledPaymentId,
  );

  const attachedRow = await attachGatewayData(service, tenantId, receivableId, claimToken, payment);
  if (!attachedRow) {
    const enclosed = await resolveLostClaim(service, tenantId, config, receivableId, payment.paymentId);
    return { receivable: enclosed, reused: true };
  }
  return { receivable: attachedRow, reused: false };
}

/**
 * Obtém a cobrança do gateway para a conta, sem criar um segundo PIX vivo:
 * 1. retomada por `externalReference` (crash entre POST e attach);
 * 2. senão, o único `POST /payments` autorizado pelo claim.
 */
async function obtainGatewayPayment(
  config: GatewayConfig,
  receivableId: string,
  currentPaymentId: string | null,
  asaasCustomerId: string,
  amountCents: number,
  descricao: string,
  excludePaymentId: string | null = null,
): Promise<GatewayPayment> {
  const existing = await findPaymentByExternalReference(config.baseUrl, config.apiKey, receivableId, {
    preferredPaymentId: currentPaymentId,
    excludePaymentId,
  });
  if (existing) return existing;

  const created = await createPixCharge(config.baseUrl, config.apiKey, {
    customerId: asaasCustomerId,
    amountCents,
    externalReference: receivableId,
    expiresAt: new Date(Date.now() + CHARGE_TTL_MS).toISOString(),
    description: `Cobrança avulsa: ${descricao}`.slice(0, 200),
  });
  if (!created.ok || !created.paymentId) {
    logEvent("receivable_charge_failed", {
      receivable_id: receivableId,
      code: "GATEWAY_ERROR",
    });
    throw new ApiError(422, "GATEWAY_ERROR");
  }
  return {
    paymentId: created.paymentId,
    pixQrCode: created.pixQrCode,
    pixCopyPaste: created.pixCopyPaste,
  };
}

/**
 * Claim perdido entre o gateway e o attach: relê a linha e só derruba o pagamento
 * criado por ESTA chamada quando ele não é o que ficou gravado. Nunca cancela o
 * PIX do vencedor.
 */
async function resolveLostClaim(
  service: SupabaseClient,
  tenantId: string,
  config: GatewayConfig,
  receivableId: string,
  ourPaymentId: string,
): Promise<ReceivableRow> {
  const winner = await loadReceivable(service, tenantId, receivableId);
  if (winner.asaas_payment_id === ourPaymentId) return winner;

  if (winner.asaas_payment_id === null) {
    // Nada gravado: o vencedor pode adotar justamente este pagamento via
    // `externalReference`. Não cancelar — devolver retryable.
    throw new ApiError(409, "GATEWAY_IN_PROGRESS");
  }

  await cancelPayment(config.baseUrl, config.apiKey, ourPaymentId);
  logEvent("receivable_charge_race_lost", {
    tenant_id: tenantId,
    receivable_id: receivableId,
    code: "GATEWAY_CLAIM_LOST",
  });
  return winner;
}

async function loadReceivable(
  service: SupabaseClient,
  tenantId: string,
  receivableId: string,
): Promise<ReceivableRow> {
  const { data, error } = await service
    .from("receivables")
    .select(RECEIVABLE_SELECT)
    .eq("tenant_id", tenantId)
    .eq("id", receivableId)
    .maybeSingle();
  if (error) throw new ApiError(500, "INTERNAL");
  if (!data) throw new ApiError(404, "RECEIVABLE_NOT_FOUND");
  return data as ReceivableRow;
}

async function loadCustomer(
  service: SupabaseClient,
  tenantId: string,
  customerId: string,
): Promise<{ name: string; email: string | null; phone: string | null }> {
  const { data, error } = await service
    .from("customers")
    .select("name, email, phone")
    .eq("tenant_id", tenantId)
    .eq("id", customerId)
    .maybeSingle();
  if (error) throw new ApiError(500, "INTERNAL");
  if (!data) throw new ApiError(404, "CUSTOMER_NOT_FOUND");
  return {
    name: String(data.name ?? "Cliente"),
    email: (data.email as string | null) ?? null,
    phone: (data.phone as string | null) ?? null,
  };
}

async function assertWhatsappOptIn(
  service: SupabaseClient,
  tenantId: string,
  customerId: string,
): Promise<void> {
  const { data, error } = await service
    .from("customers")
    .select("whatsapp_opt_in")
    .eq("tenant_id", tenantId)
    .eq("id", customerId)
    .maybeSingle();
  if (error) throw new ApiError(500, "INTERNAL");
  if (!data) throw new ApiError(404, "CUSTOMER_NOT_FOUND");
  if (data.whatsapp_opt_in !== true) throw new ApiError(422, "WHATSAPP_OPT_IN_REQUIRED");
}

async function loadGatewayConfig(
  service: SupabaseClient,
  tenantId: string,
): Promise<GatewayConfig | null> {
  const { data, error } = await service
    .from("tenant_asaas_config")
    .select("active, environment, asaas_api_key_encrypted")
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (error) throw new ApiError(500, "INTERNAL");
  if (!data || data.active !== true || !data.asaas_api_key_encrypted) return null;
  try {
    return {
      baseUrl: asaasBaseUrl(data.environment === "production" ? "production" : "sandbox"),
      apiKey: await decryptText(data.asaas_api_key_encrypted as string),
    };
  } catch {
    throw new ApiError(500, "INTERNAL");
  }
}

/** Porta de claim sobre `receivables` (mesmo primitivo usado por `charges`). */
function receivableClaimAdapter(
  service: SupabaseClient,
  tenantId: string,
  receivableId: string,
): GatewayClaimAdapter {
  return {
    read: async () => {
      const { data, error } = await service
        .from("receivables")
        .select(RECEIVABLE_SELECT)
        .eq("tenant_id", tenantId)
        .eq("id", receivableId)
        .maybeSingle();
      if (error) throw new ApiError(500, "INTERNAL");
      return data ? toChargeState(data as ReceivableRow) : null;
    },
    claim: async () => {
      const { data, error } = await service.rpc("claim_receivable_gateway", {
        p_tenant_id: tenantId,
        p_receivable_id: receivableId,
        p_ttl_seconds: GATEWAY_CLAIM_TTL_SECONDS,
      });
      if (error) throw mapRpcError(error);
      const record = (data ?? {}) as Record<string, unknown>;
      const state = record.receivable ? asChargeState(record.receivable) : null;
      const claimToken = typeof record.claim_token === "string" ? record.claim_token : null;
      return { claimed: record.claimed === true, claimToken, state };
    },
  };
}

/**
 * Grava os dados do gateway sob o fence do claim. `null` quando o claim mudou de
 * dono (o chamador relê a linha e decide o órfão).
 */
async function attachGatewayData(
  service: SupabaseClient,
  tenantId: string,
  receivableId: string,
  claimToken: string,
  payment: GatewayPayment,
): Promise<ReceivableRow | null> {
  const { data, error } = await service.rpc("attach_receivable_gateway_data", {
    p_tenant_id: tenantId,
    p_receivable_id: receivableId,
    p_claim_token: claimToken,
    p_asaas_payment_id: payment.paymentId,
    p_pix_qr_code: payment.pixQrCode,
    p_pix_copy_paste: payment.pixCopyPaste,
    p_expires_at: new Date(Date.now() + CHARGE_TTL_MS).toISOString(),
  });
  if (error) {
    const mapped = mapRpcError(error);
    if (mapped.code === "GATEWAY_CLAIM_LOST") return null;
    throw mapped;
  }
  const record = (data ?? {}) as Record<string, unknown>;
  if (!record.id) return null;
  return {
    id: String(record.id),
    customer_id: String(record.customer_id),
    descricao: String(record.descricao ?? ""),
    valor_cents: Number(record.valor_cents ?? 0),
    status: String(record.status ?? "pendente"),
    asaas_payment_id: (record.asaas_payment_id as string | null) ?? null,
    pix_qr_code: (record.pix_qr_code as string | null) ?? null,
    pix_copy_paste: (record.pix_copy_paste as string | null) ?? null,
    charge_expires_at: (record.charge_expires_at as string | null) ?? null,
  };
}

/** Libera o claim (no-op quando o `attach` já limpou ou o token mudou de dono). */
async function releaseClaim(
  service: SupabaseClient,
  tenantId: string,
  receivableId: string,
  claimToken: string,
): Promise<void> {
  try {
    await service.rpc("release_receivable_gateway_claim", {
      p_tenant_id: tenantId,
      p_receivable_id: receivableId,
      p_claim_token: claimToken,
    });
  } catch {
    // Claim expira sozinho pelo TTL; nunca mascarar a resposta principal.
  }
}

async function clearExpiredGatewayData(
  service: SupabaseClient,
  tenantId: string,
  receivableId: string,
  expectedPaymentId: string,
): Promise<void> {
  const { error } = await service.rpc("clear_receivable_gateway_data", {
    p_tenant_id: tenantId,
    p_receivable_id: receivableId,
    p_expected_payment_id: expectedPaymentId,
  });
  if (error) throw mapRpcError(error);
}

/** Enfileira a cobrança no WhatsApp quando pedido; dedupe por conta + PIX. */
async function maybeQueueWhatsapp(
  service: SupabaseClient,
  tenantId: string,
  receivable: ReceivableRow,
  requested: boolean,
): Promise<WhatsappOutcome> {
  if (!requested) return { requested: false, queued: false, message_id: null };

  const dedupeKey = `receivable:${receivable.id}:${receivable.asaas_payment_id ?? "sem-pix"}`;

  const { data: existing, error: existingError } = await service
    .from("messages")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("dedupe_key", dedupeKey)
    .in("status", ["fila", "enviado", "entregue"])
    .maybeSingle();
  if (existingError) throw new ApiError(500, "INTERNAL");
  if (existing) {
    return { requested: true, queued: false, message_id: existing.id as string };
  }

  const { data: queued, error: insertError } = await service
    .from("messages")
    .insert({
      tenant_id: tenantId,
      customer_id: receivable.customer_id,
      appointment_id: null,
      channel: "whatsapp",
      template: "cobranca",
      status: "fila",
      payload: { receivable_id: receivable.id, valor_cents: receivable.valor_cents },
      dedupe_key: dedupeKey,
    })
    .select("id")
    .single();
  if (insertError) {
    if (insertError.code === "23505") {
      const { data: winner } = await service
        .from("messages")
        .select("id")
        .eq("tenant_id", tenantId)
        .eq("dedupe_key", dedupeKey)
        .in("status", ["fila", "enviado", "entregue"])
        .maybeSingle();
      return { requested: true, queued: false, message_id: (winner?.id as string | undefined) ?? null };
    }
    throw new ApiError(500, "INTERNAL");
  }

  return { requested: true, queued: true, message_id: queued.id as string };
}
