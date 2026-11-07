import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import {
  asaasBaseUrl,
  cancelPayment,
  createPixCharge,
  decryptText,
  ensureAsaasCustomer,
  findPaymentByExternalReference,
} from "../_shared/asaas.ts";
import { isProfessionalOwner, resolveIdentity, type Identity } from "../_shared/identity.ts";
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
  ensureSingleGatewayCreation,
  mergeChargeState,
  type ChargeState,
} from "../_shared/gateway-claim.ts";
import { requestSchema } from "./schemas.ts";

export type HandlerOptions = { createService: () => SupabaseClient };

function successBody(charge: ChargeState): Record<string, unknown> {
  return {
    charge_id: charge.charge_id,
    amount_cents: charge.amount_cents,
    pix_qr_code: charge.pix_qr_code ?? null,
    pix_copy_paste: charge.pix_copy_paste ?? null,
    expires_at: charge.expires_at ?? null,
    reused: charge.reused,
    requested_amount_mismatch: charge.requested_amount_mismatch,
  };
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
      const parsed = requestSchema.safeParse(raw);
      if (!parsed.success) throw new ApiError(400, "INVALID_BODY");
      const body = parsed.data;

      const { data: appointment, error: appointmentError } = await service
        .from("appointments")
        .select("id, status, customer_id, professional_id")
        .eq("tenant_id", identity.tenantId)
        .eq("id", body.appointment_id)
        .maybeSingle();
      if (appointmentError) throw new ApiError(500, "INTERNAL");
      if (!appointment) throw new ApiError(404, "APPOINTMENT_NOT_FOUND");

      if (identity.role === "professional") {
        const owns = await isProfessionalOwner(
          service,
          identity.tenantId,
          identity.userId,
          appointment.professional_id as string,
        );
        if (!owns) throw new ApiError(403, "PROFESSIONAL_NOT_OWNER");
      }

      const config = await loadGatewayConfig(service, identity.tenantId);
      if (!config) throw new ApiError(422, "ASAAS_NOT_CONFIGURED");

      const idempotencyKey = body.idempotency_key ?? crypto.randomUUID();
      const { data: reservedData, error: reserveError } = await service.rpc(
        "reserve_appointment_charge",
        {
          p_tenant_id: identity.tenantId,
          p_actor_id: identity.userId,
          p_appointment_id: body.appointment_id,
          p_amount_cents: body.amount_cents ?? null,
          p_idempotency_key: idempotencyKey,
        },
      );
      if (reserveError) throw mapRpcError(reserveError);

      let reserved = asChargeState(reservedData);

      if (reserved.reissue) {
        const cancellation = await cancelPreviousCharge(
          service,
          identity,
          body.appointment_id,
          reserved,
          config,
        );
        if (!cancellation.ok) {
          logEvent("charge_reissue_cancel_failed", {
            tenant_id: identity.tenantId,
            actor_id: identity.userId,
            appointment_id: body.appointment_id,
            charge_id: reserved.previous_charge_id,
            code: "GATEWAY_CANCEL_FAILED",
          });
          throw new ApiError(422, "GATEWAY_CANCEL_FAILED");
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

      if (reserved.reused && reserved.pix_qr_code) {
        logEvent("charge_reused", {
          tenant_id: identity.tenantId,
          actor_id: identity.userId,
          appointment_id: body.appointment_id,
          charge_id: reserved.charge_id,
          amount_cents: reserved.amount_cents,
          replayed: true,
        });
        return jsonResponse(successBody(reserved), 200);
      }

      const claimRef: { token: string | null } = { token: null };
      try {
        reserved = await ensureSingleGatewayCreation({
          service,
          tenantId: identity.tenantId,
          charge: reserved,
          claimTokenRef: claimRef,
          create: (claimToken) =>
            attachGatewayData(
              service,
              identity,
              appointment.customer_id as string,
              reserved,
              config,
              claimToken,
            ),
        });
      } catch (error) {
        if (error instanceof ApiError && error.code === "GATEWAY_IN_PROGRESS") {
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
            },
            409,
          );
        }

        await cancelReservation(service, identity, reserved.charge_id, claimRef.token);
        await auditFailure(service, identity, body.appointment_id, reserved.charge_id);
        const mapped = error instanceof ApiError ? error : new ApiError(422, "GATEWAY_ERROR");
        logEvent("charge_creation_failed", {
          tenant_id: identity.tenantId,
          actor_id: identity.userId,
          appointment_id: body.appointment_id,
          charge_id: reserved.charge_id,
          amount_cents: reserved.amount_cents,
          code: mapped.code,
        });
        throw new ApiError(422, "GATEWAY_ERROR");
      }

      logEvent("charge_created", {
        tenant_id: identity.tenantId,
        actor_id: identity.userId,
        appointment_id: body.appointment_id,
        charge_id: reserved.charge_id,
        amount_cents: reserved.amount_cents,
        replayed: reserved.reused,
      });
      return jsonResponse(successBody(reserved), 200);
    } catch (error) {
      return errorResponse(error);
    }
  };
}

async function loadGatewayConfig(
  service: SupabaseClient,
  tenantId: string,
): Promise<{ baseUrl: string; apiKey: string } | null> {
  const { data: config, error } = await service
    .from("tenant_asaas_config")
    .select("active, environment, asaas_api_key_encrypted")
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (error) throw new ApiError(500, "INTERNAL");
  if (!config || config.active !== true || !config.asaas_api_key_encrypted) return null;
  try {
    return {
      baseUrl: asaasBaseUrl(config.environment === "production" ? "production" : "sandbox"),
      apiKey: await decryptText(config.asaas_api_key_encrypted as string),
    };
  } catch {
    throw new ApiError(500, "INTERNAL");
  }
}

async function cancelPreviousCharge(
  service: SupabaseClient,
  identity: Identity,
  appointmentId: string,
  reserved: ChargeState,
  config: { baseUrl: string; apiKey: string },
): Promise<{ ok: boolean }> {
  if (!reserved.previous_asaas_payment_id) return { ok: true };

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
    // Auditoria best-effort; a reabertura local abaixo preserva a consistência.
  }

  return { ok: true };
}

async function attachGatewayData(
  service: SupabaseClient,
  identity: Identity,
  customerId: string,
  reserved: ChargeState,
  config: { baseUrl: string; apiKey: string },
  claimToken: string,
): Promise<ChargeState> {
  const { data: customer, error: customerError } = await service
    .from("customers")
    .select("name, email, phone")
    .eq("tenant_id", identity.tenantId)
    .eq("id", customerId)
    .maybeSingle();
  if (customerError) throw new ApiError(500, "INTERNAL");

  const asaasCustomerId = await ensureAsaasCustomer(config.baseUrl, config.apiKey, {
    customerId,
    name: customer?.name ?? "Cliente",
    email: customer?.email ?? null,
    phone: customer?.phone ?? null,
  });
  if (!asaasCustomerId) throw new ApiError(422, "GATEWAY_ERROR");

  let payment = await findPaymentByExternalReference(
    config.baseUrl,
    config.apiKey,
    reserved.charge_id,
  );
  if (!payment) {
    const created = await createPixCharge(config.baseUrl, config.apiKey, {
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
        cancel: (paymentId) => cancelPayment(config.baseUrl, config.apiKey, paymentId),
      });
      logEvent("charge_claim_lost", {
        tenant_id: identity.tenantId,
        actor_id: identity.userId,
        charge_id: reserved.charge_id,
        payment_id: payment.paymentId,
        status: resolution.samePayment ? "reconciled" : (resolution.cancelled ? "cancelled" : "kept"),
        code: mapped.code,
      });
      // O vencedor já anexou ESTE payment: nada a cancelar; a cobrança está correta.
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
      cancel: (paymentId) => cancelPayment(config.baseUrl, config.apiKey, paymentId),
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
    // Claim vivo de outro criador: não é falha de liberação, é fence.
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
