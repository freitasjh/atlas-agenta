import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import {
  asaasBaseUrl,
  cancelPayment,
  createPixCharge,
  decryptText,
  ensureAsaasCustomer,
  findPaymentByExternalReference,
} from "../_shared/asaas.ts";
import { resolveIdentity, type Identity } from "../_shared/identity.ts";
import {
  ApiError,
  CORS_HEADERS,
  errorResponse,
  jsonResponse,
  logEvent,
  mapRpcError,
  messageForCode,
} from "../_shared/http.ts";
import {
  asChargeState,
  cancelPaymentIfOrphan,
  chargePayload,
  ensureSingleGatewayCreation,
  mergeChargeState,
  type ChargeState,
} from "../_shared/gateway-claim.ts";
import { loadActivePendingCharge, loadSettlement } from "../_shared/payments.ts";
import { requestSchema, schemaErrorCode } from "./schemas.ts";

export type HandlerOptions = { createService: () => SupabaseClient };

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
      const record = raw as Record<string, unknown>;
      if (
        record.idempotency_key === undefined ||
        record.idempotency_key === null ||
        record.idempotency_key === ""
      ) {
        throw new ApiError(400, "IDEMPOTENCY_KEY_REQUIRED");
      }

      const parsed = requestSchema.safeParse(raw);
      if (!parsed.success) throw new ApiError(400, schemaErrorCode(parsed.error));
      const body = parsed.data;

      const { data: registered, error: registerError } = await service.rpc(
        "register_appointment_payments",
        {
          p_tenant_id: identity.tenantId,
          p_actor_id: identity.userId,
          p_appointment_id: body.appointment_id,
          p_payments: body.payments.map((payment) => ({
            method: payment.method,
            amount_cents: payment.amount_cents,
            ...(payment.tip_cents === undefined ? {} : { tip_cents: payment.tip_cents }),
          })),
          p_idempotency_key: body.idempotency_key,
          p_close_appointment: body.close_appointment,
        },
      );
      if (registerError) throw mapRpcError(registerError);

      const registerResult = (registered ?? {}) as Record<string, unknown>;
      const pixAmount = Number(registerResult.pix_amount_cents ?? 0);
      const replayed = registerResult.replayed === true;
      let charge: Record<string, unknown> | null = null;

      if (pixAmount > 0) {
        if (replayed) {
          // Replay nunca reserva nem chama o gateway: só reapresenta a cobrança
          // pendente ativa que já existir (paga/cancelada => charge null).
          const pending = await loadActivePendingCharge(
            service,
            identity.tenantId,
            body.appointment_id,
          );
          charge = pending === null ? null : {
            id: pending.id,
            amount_cents: pending.amount_cents,
            pix_qr_code: pending.pix_qr_code,
            pix_copy_paste: pending.pix_copy_paste,
            expires_at: pending.expires_at,
          };
        } else {
          const { data: reservedData, error: reserveError } = await service.rpc(
            "reserve_appointment_charge",
            {
              p_tenant_id: identity.tenantId,
              p_actor_id: identity.userId,
              p_appointment_id: body.appointment_id,
              p_amount_cents: pixAmount,
              p_idempotency_key: body.idempotency_key,
            },
          );

          if (reserveError) {
            const mapped = mapRpcError(reserveError);
            if (mapped.status === 409) {
              const settlement = await loadSettlement(service, identity, body.appointment_id);
              return jsonResponse(
                {
                  code: mapped.code,
                  message: messageForCode(mapped.code),
                  settlement,
                  pix_amount_cents: pixAmount,
                },
                409,
              );
            }
            throw mapped;
          }

          let reserved = asChargeState(reservedData);

          if (reserved.reissue) {
            const cancellation = await cancelPreviousCharge(
              service,
              identity,
              body.appointment_id,
              reserved,
            );
            if (!cancellation.ok) {
              const settlement = await loadSettlement(service, identity, body.appointment_id);
              logEvent("charge_reissue_cancel_failed", {
                tenant_id: identity.tenantId,
                actor_id: identity.userId,
                appointment_id: body.appointment_id,
                charge_id: reserved.previous_charge_id,
                code: "GATEWAY_CANCEL_FAILED",
              });
              return jsonResponse(
                {
                  code: "GATEWAY_CANCEL_FAILED",
                  message: messageForCode("GATEWAY_CANCEL_FAILED"),
                  retryable: true,
                  settlement,
                  pix_amount_cents: pixAmount,
                },
                422,
              );
            }

            const { data: reopened, error: reopenError } = await service.rpc(
              "reopen_charge_for_reissue",
              {
                p_tenant_id: identity.tenantId,
                p_charge_id: reserved.previous_charge_id,
                p_expires_at: null,
              },
            );
            if (reopenError) throw mapRpcError(reopenError);
            reserved = asChargeState(reopened);
          }

          charge = chargePayload(reserved);

          if (!reserved.pix_qr_code) {
            const claimRef: { token: string | null } = { token: null };
            try {
              reserved = await ensureSingleGatewayCreation({
                service,
                tenantId: identity.tenantId,
                charge: reserved,
                claimTokenRef: claimRef,
                create: (claimToken) =>
                  attachGatewayData(service, identity, body.appointment_id, reserved, claimToken),
              });
              charge = chargePayload(reserved);
            } catch (error) {
              if (error instanceof ApiError && error.code === "GATEWAY_IN_PROGRESS") {
                const settlement = await loadSettlement(service, identity, body.appointment_id);
                logEvent("charge_gateway_in_progress", {
                  tenant_id: identity.tenantId,
                  actor_id: identity.userId,
                  appointment_id: body.appointment_id,
                  charge_id: reserved.charge_id,
                  code: error.code,
                });
                return jsonResponse(
                  {
                    code: error.code,
                    message: messageForCode(error.code),
                    retryable: true,
                    settlement,
                    pix_amount_cents: pixAmount,
                  },
                  409,
                );
              }

              await cancelReservation(service, identity, reserved.charge_id, claimRef.token);
              await auditFailure(service, identity, body.appointment_id, reserved.charge_id);
              const mapped = error instanceof ApiError ? error : new ApiError(422, "GATEWAY_ERROR");
              const settlement = await loadSettlement(service, identity, body.appointment_id);
              logEvent("charge_creation_failed", {
                tenant_id: identity.tenantId,
                actor_id: identity.userId,
                appointment_id: body.appointment_id,
                charge_id: reserved.charge_id,
                amount_cents: reserved.amount_cents,
                code: mapped.code,
              });
              return jsonResponse(
                {
                  code: mapped.code,
                  message: messageForCode(mapped.code),
                  retryable: true,
                  settlement,
                  pix_amount_cents: pixAmount,
                },
                mapped.status === 500 ? 422 : mapped.status,
              );
            }
          }
        }
      }

      const settlement = await loadSettlement(service, identity, body.appointment_id);
      logEvent("payments_registered", {
        tenant_id: identity.tenantId,
        actor_id: identity.userId,
        appointment_id: body.appointment_id,
        amount_cents: Number(registerResult.total_paid_cents ?? 0),
        replayed,
      });
      return jsonResponse({ settlement, charge, replayed }, 200);
    } catch (error) {
      return errorResponse(error);
    }
  };
}

async function loadTenantConfig(
  service: SupabaseClient,
  identity: Identity,
): Promise<{ baseUrl: string; apiKey: string }> {
  const { data: config, error } = await service
    .from("tenant_asaas_config")
    .select("active, environment, asaas_api_key_encrypted")
    .eq("tenant_id", identity.tenantId)
    .maybeSingle();
  if (error) throw new ApiError(500, "INTERNAL");
  if (!config || config.active !== true || !config.asaas_api_key_encrypted) {
    throw new ApiError(422, "ASAAS_NOT_CONFIGURED");
  }
  let apiKey: string;
  try {
    apiKey = await decryptText(config.asaas_api_key_encrypted as string);
  } catch {
    throw new ApiError(500, "INTERNAL");
  }
  const baseUrl = asaasBaseUrl(config.environment === "production" ? "production" : "sandbox");
  return { baseUrl, apiKey };
}

/**
 * Cancela no Asaas a cobrança anterior de uma reemissão.
 * 404 é tratado como já cancelada. Sem gateway id, não há chamada externa.
 * Falha do gateway OU config ausente => `ok:false` (o chamador devolve 422 sem reabrir).
 */
async function cancelPreviousCharge(
  service: SupabaseClient,
  identity: Identity,
  appointmentId: string,
  reserved: ChargeState,
): Promise<{ ok: boolean }> {
  if (!reserved.previous_asaas_payment_id) return { ok: true };

  let config: { baseUrl: string; apiKey: string };
  try {
    config = await loadTenantConfig(service, identity);
  } catch {
    return { ok: false };
  }

  const cancelled = await cancelPayment(
    config.baseUrl,
    config.apiKey,
    reserved.previous_asaas_payment_id,
  );
  if (!cancelled.ok && !cancelled.notFound) return { ok: false };

  try {
    await service.from("audit_log").insert({
      tenant_id: identity.tenantId,
      actor_id: identity.userId,
      action: "charge_previous_cancelled",
      target_type: "charge",
      target_id: reserved.previous_charge_id,
      metadata: {
        appointment_id: appointmentId,
        charge_id: reserved.previous_charge_id,
        had_asaas_payment_id: true,
        code: "REISSUE",
      },
    });
  } catch {
    // Auditoria é best-effort aqui; a transição local já está protegida pelo reopen.
  }

  return { ok: true };
}

async function attachGatewayData(
  service: SupabaseClient,
  identity: Identity,
  appointmentId: string,
  reserved: ChargeState,
  claimToken: string,
): Promise<ChargeState> {
  const { baseUrl, apiKey } = await loadTenantConfig(service, identity);

  const { data: appointment, error: appointmentError } = await service
    .from("appointments")
    .select("customer_id")
    .eq("tenant_id", identity.tenantId)
    .eq("id", appointmentId)
    .maybeSingle();
  if (appointmentError) throw new ApiError(500, "INTERNAL");
  if (!appointment) throw new ApiError(404, "APPOINTMENT_NOT_FOUND");

  const { data: customer, error: customerError } = appointment.customer_id
    ? await service
        .from("customers")
        .select("name, email, phone")
        .eq("tenant_id", identity.tenantId)
        .eq("id", appointment.customer_id)
        .maybeSingle()
    : { data: null, error: null };
  if (customerError) throw new ApiError(500, "INTERNAL");

  const asaasCustomerId = await ensureAsaasCustomer(baseUrl, apiKey, {
    // Walk-in anônimo (1R): sem linha em `customers`. O gateway exige um
    // customer — o `externalReference` é o próprio appointment (sem PII, sem
    // cliente sintético no nosso banco, sem telefone fake).
    customerId:
      appointment.customer_id ?? `walkin:${appointmentId}`,
    name: (customer?.name as string | null) ?? "Cliente de balcão",
    email: (customer?.email as string | null) ?? null,
    phone: (customer?.phone as string | null) ?? null,
  });
  if (!asaasCustomerId) throw new ApiError(422, "GATEWAY_ERROR");

  // Retomada após crash entre reserva e gateway: externalReference = charges.id.
  let payment = await findPaymentByExternalReference(baseUrl, apiKey, reserved.charge_id);
  if (!payment) {
    const created = await createPixCharge(baseUrl, apiKey, {
      customerId: asaasCustomerId,
      amountCents: reserved.amount_cents,
      externalReference: reserved.charge_id,
      expiresAt: reserved.expires_at ?? new Date(Date.now() + 3 * 86_400_000).toISOString(),
      description: "Cobrança de atendimento",
    });
    if (!created.ok || !created.paymentId) throw new ApiError(422, "GATEWAY_ERROR");
    payment = {
      paymentId: created.paymentId,
      pixQrCode: created.pixQrCode,
      pixCopyPaste: created.pixCopyPaste,
    };
  }

  const { data: attached, error: attachError } = await service.rpc(
    "attach_charge_gateway_data",
    {
      p_tenant_id: identity.tenantId,
      p_charge_id: reserved.charge_id,
      p_claim_token: claimToken,
      p_asaas_payment_id: payment.paymentId,
      p_pix_qr_code: payment.pixQrCode,
      p_pix_copy_paste: payment.pixCopyPaste,
      p_expires_at: reserved.expires_at,
    },
  );
  if (attachError) {
    const mapped = mapRpcError(attachError);
    if (mapped.code === "GATEWAY_CLAIM_LOST") {
      const resolution = await cancelPaymentIfOrphan({
        service,
        tenantId: identity.tenantId,
        chargeId: reserved.charge_id,
        paymentId: payment.paymentId,
        cancel: (paymentId) => cancelPayment(baseUrl, apiKey, paymentId),
      });
      logEvent("charge_claim_lost", {
        tenant_id: identity.tenantId,
        actor_id: identity.userId,
        charge_id: reserved.charge_id,
        payment_id: payment.paymentId,
        status: resolution.samePayment ? "reconciled" : (resolution.cancelled ? "cancelled" : "kept"),
        code: mapped.code,
      });
      if (resolution.samePayment && resolution.charge) {
        return mergeChargeState(reserved, resolution.charge);
      }
      throw new ApiError(409, "GATEWAY_IN_PROGRESS");
    }
    await cancelPaymentIfOrphan({
      service,
      tenantId: identity.tenantId,
      chargeId: reserved.charge_id,
      paymentId: payment.paymentId,
      cancel: (paymentId) => cancelPayment(baseUrl, apiKey, paymentId),
    });
    throw mapped;
  }

  const attachedState = asChargeState(attached);
  return mergeChargeState(reserved, attachedState);
}

async function cancelReservation(
  service: SupabaseClient,
  identity: Identity,
  chargeId: string,
  claimToken: string | null,
): Promise<void> {
  const { error } = await service.rpc("release_charge_reservation", {
    p_tenant_id: identity.tenantId,
    p_charge_id: chargeId,
    p_actor_id: identity.userId,
    p_claim_token: claimToken,
  });
  if (error) {
    const mapped = mapRpcError(error);
    if (mapped.code === "GATEWAY_IN_PROGRESS") {
      logEvent("charge_reservation_claim_held", {
        tenant_id: identity.tenantId,
        actor_id: identity.userId,
        charge_id: chargeId,
        code: mapped.code,
      });
      return;
    }
    logEvent("charge_reservation_release_failed", {
      tenant_id: identity.tenantId,
      actor_id: identity.userId,
      charge_id: chargeId,
      code: "INTERNAL",
    });
    throw new ApiError(500, "INTERNAL");
  }
}

async function auditFailure(
  service: SupabaseClient,
  identity: Identity,
  appointmentId: string,
  chargeId: string,
): Promise<void> {
  await service.from("audit_log").insert({
    tenant_id: identity.tenantId,
    actor_id: identity.userId,
    action: "charge_creation_failed",
    target_type: "charge",
    target_id: chargeId,
    metadata: { appointment_id: appointmentId, charge_id: chargeId, code: "GATEWAY_ERROR" },
  });
}
