// Claim atômico de criação da cobrança no gateway (ADR-002 review).
//
// Garantia central: no máximo UM `POST /payments` por linha de `charges`.
// Quem pega o claim cria; quem perde espera o `asaas_payment_id` aparecer e
// reapresenta a mesma cobrança. Sem dados aparecendo no TTL curto, devolve
// `409 GATEWAY_IN_PROGRESS` (retryable), nunca cria uma segunda cobrança.
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { ApiError, mapRpcError } from "./http.ts";

/**
 * TTL do claim acima do pior caso de I/O agregado: `ensureAsaasCustomer`
 * (GET + POST), `findPaymentByExternalReference` (GET + GET pixQrCode) e
 * `createPixCharge` (POST + GET pixQrCode) = até 6 chamadas de 20s (~120s).
 * 180s cobre o orçamento com folga; o RPC aceita no máximo 900.
 */
export const GATEWAY_CLAIM_TTL_SECONDS = 180;

export interface ChargeState {
  charge_id: string;
  amount_cents: number;
  status: string;
  asaas_payment_id: string | null;
  pix_qr_code: string | null;
  pix_copy_paste: string | null;
  expires_at: string | null;
  gateway_claimed_at: string | null;
  gateway_claim_expires_at: string | null;
  reused: boolean;
  reopened: boolean;
  reissue: boolean;
  requested_amount_mismatch: boolean;
  previous_charge_id: string | null;
  previous_asaas_payment_id: string | null;
}

export function asChargeState(value: unknown): ChargeState {
  const record = (value ?? {}) as Record<string, unknown>;
  const previousChargeId = record.previous_charge_id;
  return {
    charge_id: String(record.charge_id ?? ""),
    amount_cents: Number(record.amount_cents ?? 0),
    status: String(record.status ?? ""),
    asaas_payment_id: (record.asaas_payment_id as string | null) ?? null,
    pix_qr_code: (record.pix_qr_code as string | null) ?? null,
    pix_copy_paste: (record.pix_copy_paste as string | null) ?? null,
    expires_at: (record.expires_at as string | null) ?? null,
    gateway_claimed_at: (record.gateway_claimed_at as string | null) ?? null,
    gateway_claim_expires_at:
      (record.gateway_claim_expires_at as string | null) ?? null,
    reused: record.reused === true,
    reopened: record.reopened === true,
    reissue: record.reissue === true,
    requested_amount_mismatch: record.requested_amount_mismatch === true,
    previous_charge_id: previousChargeId === undefined || previousChargeId === null
      ? null
      : String(previousChargeId),
    previous_asaas_payment_id:
      (record.previous_asaas_payment_id as string | null) ?? null,
  };
}

export function chargePayload(charge: ChargeState): Record<string, unknown> {
  return {
    id: charge.charge_id,
    amount_cents: charge.amount_cents,
    pix_qr_code: charge.pix_qr_code ?? null,
    pix_copy_paste: charge.pix_copy_paste ?? null,
    expires_at: charge.expires_at ?? null,
  };
}

export async function readChargeState(
  service: SupabaseClient,
  tenantId: string,
  chargeId: string,
): Promise<ChargeState | null> {
  const { data, error } = await service
    .from("charges")
    .select(
      "id, amount_cents, status, asaas_payment_id, pix_qr_code, pix_copy_paste, expires_at, gateway_claimed_at, gateway_claim_expires_at",
    )
    .eq("tenant_id", tenantId)
    .eq("id", chargeId)
    .maybeSingle();
  if (error) throw new ApiError(500, "INTERNAL");
  if (!data) return null;
  return asChargeState({
    charge_id: data.id,
    amount_cents: data.amount_cents,
    status: data.status,
    asaas_payment_id: data.asaas_payment_id,
    pix_qr_code: data.pix_qr_code,
    pix_copy_paste: data.pix_copy_paste,
    expires_at: data.expires_at,
    gateway_claimed_at: data.gateway_claimed_at,
    gateway_claim_expires_at: data.gateway_claim_expires_at,
  });
}

/** Copia para `base` os campos de gateway/estado relidos de uma cobrança. */
export function mergeChargeState(base: ChargeState, latest: ChargeState): ChargeState {
  return {
    ...base,
    charge_id: latest.charge_id || base.charge_id,
    amount_cents: latest.amount_cents,
    status: latest.status,
    asaas_payment_id: latest.asaas_payment_id,
    pix_qr_code: latest.pix_qr_code,
    pix_copy_paste: latest.pix_copy_paste,
    expires_at: latest.expires_at,
    gateway_claimed_at: latest.gateway_claimed_at,
    gateway_claim_expires_at: latest.gateway_claim_expires_at,
  };
}

/**
 * Resolve o payment criado por quem PERDEU o claim.
 * - `charges.asaas_payment_id` já aponta para esse payment (vencedor anexou ou
 *   replay encontrou o mesmo `externalReference`) => nada a cancelar.
 * - payment órfão => `cancel` é chamado.
 * - leitura falhou => não cancela (nunca apaga o payment de outro criador às cegas).
 */
export async function cancelPaymentIfOrphan(args: {
  service: SupabaseClient;
  tenantId: string;
  chargeId: string;
  paymentId: string;
  cancel: (paymentId: string) => Promise<{ ok: boolean; status: number }>;
}): Promise<{ charge: ChargeState | null; samePayment: boolean; cancelled: boolean }> {
  let charge: ChargeState | null = null;
  try {
    charge = await readChargeState(args.service, args.tenantId, args.chargeId);
  } catch {
    return { charge: null, samePayment: false, cancelled: false };
  }

  if (charge?.asaas_payment_id === args.paymentId) {
    return { charge, samePayment: true, cancelled: false };
  }

  const result = await args.cancel(args.paymentId);
  return { charge, samePayment: false, cancelled: result.ok };
}

async function claimGateway(
  service: SupabaseClient,
  tenantId: string,
  chargeId: string,
): Promise<{ claimed: boolean; claimToken: string | null; charge: ChargeState }> {
  const { data, error } = await service.rpc("claim_charge_gateway", {
    p_tenant_id: tenantId,
    p_charge_id: chargeId,
    p_ttl_seconds: GATEWAY_CLAIM_TTL_SECONDS,
  });
  if (error) throw mapRpcError(error);
  const record = (data ?? {}) as Record<string, unknown>;
  const charge = asChargeState(record.charge);
  return {
    claimed: record.claimed === true,
    claimToken: charge.gateway_claimed_at,
    charge,
  };
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Espera a cobrança ganhar `asaas_payment_id` (quem pegou o claim está criando).
 * Retorna a cobrança quando o gateway anexou os dados; `null` quando o TTL acabou,
 * a cobrança foi cancelada ou ficou paga sem QR.
 */
export async function waitForClaimedGatewayData(
  service: SupabaseClient,
  tenantId: string,
  chargeId: string,
  timeoutMs = claimWaitTimeoutMs(),
  intervalMs = 250,
): Promise<ChargeState | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const charge = await readChargeState(service, tenantId, chargeId);
    if (!charge) return null;
    if (charge.status === "pago") return charge;
    if (charge.status === "cancelado") return null;
    if (charge.asaas_payment_id) return charge;
    await sleep(intervalMs);
  }
  return null;
}

/** Timeout de espera do claim (default 5s; testes podem zerar via env). */
export function claimWaitTimeoutMs(): number {
  const raw = Deno.env.get("GATEWAY_CLAIM_WAIT_MS");
  if (raw === undefined || raw.trim() === "") return 5_000;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 5_000;
}

/**
 * Executa a criação no gateway sob o claim da cobrança.
 * - claim ganho => `create(token)` é a única chamada que faz POST /payments;
 * - claim perdido => espera os dados anexados por quem ganhou;
 * - sem dados no TTL => `409 GATEWAY_IN_PROGRESS` (retryable).
 */
export async function ensureSingleGatewayCreation(args: {
  service: SupabaseClient;
  tenantId: string;
  charge: ChargeState;
  create: (claimToken: string) => Promise<ChargeState>;
  waitTimeoutMs?: number;
  /**
   * Recebe o token quando ESTA chamada ganhou o claim. O chamador usa o token
   * para liberar a reserva com fence (`release_charge_reservation`) se o gateway
   * falhar depois do claim.
   */
  claimTokenRef?: { token: string | null };
}): Promise<ChargeState> {
  if (args.charge.pix_qr_code) return args.charge;
  // Dados já anexados por um concorrente (ou retomada por externalReference).
  if (args.charge.asaas_payment_id) return args.charge;

  const claim = await claimGateway(args.service, args.tenantId, args.charge.charge_id);
  if (claim.claimed) {
    if (!claim.claimToken) throw new ApiError(500, "INTERNAL");
    if (args.claimTokenRef) args.claimTokenRef.token = claim.claimToken;
    return args.create(claim.claimToken);
  }

  const waited = await waitForClaimedGatewayData(
    args.service,
    args.tenantId,
    args.charge.charge_id,
    args.waitTimeoutMs ?? claimWaitTimeoutMs(),
  );
  if (waited) return waited;

  throw new ApiError(409, "GATEWAY_IN_PROGRESS");
}
