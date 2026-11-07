// Fixtures do ledger de recebimento e da API de pagamentos (ADR-001/ADR-002). Tudo é criado pela
// service role: o `tenant_id` é explícito e a RLS não interfere na preparação. A limpeza respeita a
// ordem das FKs `on delete restrict` (`appointment_payments` → `charges` → `appointments`) antes de
// `deleteTestUsers()` apagar perfis e empresas.
import { randomUUID } from "node:crypto";
import { createCipheriv, createHash, randomBytes } from "node:crypto";
import { serviceClient } from "./clients.ts";
import { readFunctionsEnv } from "./env.ts";
import { createCommonUser, tenantIdOf, type TestUser } from "./users.ts";

/** Empresa de teste com o admin dono (mesmo caminho do cadastro). */
export interface PaymentsTenant {
  admin: TestUser;
  tenantId: string;
}

/** Grafo mínimo de um atendimento: cliente, profissional, serviço e o próprio atendimento. */
export interface AppointmentFixture {
  appointmentId: string;
  customerId: string;
  professionalId: string;
  serviceId: string;
}

type InsertError = { code?: string; message?: string } | null;

function must(
  label: string,
  result: { data: unknown; error: InsertError },
): any {
  if (result.error || result.data === null) {
    throw new Error(`Fixture ${label} falhou (código ${result.error?.code ?? "vazio"}).`);
  }
  return result.data;
}

export async function createPaymentsTenant(prefix: string): Promise<PaymentsTenant> {
  const admin = await createCommonUser(prefix);
  return { admin, tenantId: await tenantIdOf(admin.id) };
}

/** Cria serviço, profissional (opcionalmente ligado a um profile), cliente e atendimento. */
export async function seedAppointment(
  tenantId: string,
  options: {
    priceCents?: number;
    status?: "pendente" | "confirmado" | "em_atendimento" | "concluido" | "cancelado" | "nao_compareceu";
    professionalProfileId?: string;
  } = {},
): Promise<AppointmentFixture> {
  const admin = serviceClient();
  const suffix = randomUUID().slice(0, 8);
  const priceCents = options.priceCents ?? 10_000;

  const service = must(
    "service",
    await admin
      .from("services")
      .insert({
        tenant_id: tenantId,
        name: `Serviço ${suffix}`,
        duration_minutes: 30,
        price_cents: priceCents,
      })
      .select("id")
      .single(),
  );

  const professionalRow: Record<string, unknown> = {
    tenant_id: tenantId,
    name: `Profissional ${suffix}`,
  };
  if (options.professionalProfileId !== undefined) {
    professionalRow.profile_id = options.professionalProfileId;
  }

  // Um login liga a no máximo um profissional por tenant; reutiliza o existente.
  let professional: { id: string } | undefined;
  if (options.professionalProfileId !== undefined) {
    const { data: existing } = await admin
      .from("professionals")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("profile_id", options.professionalProfileId)
      .maybeSingle();
    professional = existing ?? undefined;
  }
  if (!professional) {
    professional = must(
      "professional",
      await admin.from("professionals").insert(professionalRow).select("id").single(),
    ) as { id: string };
  }

  const customer = must(
    "customer",
    await admin
      .from("customers")
      .insert({ tenant_id: tenantId, name: `Cliente ${suffix}`, phone: "11987654321" })
      .select("id")
      .single(),
  );

  // Janela única por fixture: a exclusão de sobreposição por profissional é global.
  const startsAt = new Date(
    Date.now() + 3_600_000 + Math.floor(Math.random() * 500_000) * 60_000,
  );
  const endsAt = new Date(startsAt.getTime() + 30 * 60_000);
  const appointment = must(
    "appointment",
    await admin
      .from("appointments")
      .insert({
        tenant_id: tenantId,
        customer_id: customer.id,
        professional_id: professional.id,
        service_id: service.id,
        starts_at: startsAt.toISOString(),
        ends_at: endsAt.toISOString(),
        price_cents: priceCents,
        status: options.status ?? "pendente",
      })
      .select("id")
      .single(),
  );

  return {
    appointmentId: appointment.id,
    customerId: customer.id,
    professionalId: professional.id,
    serviceId: service.id,
  };
}

/** Insere uma cobrança PIX (gateway-only) no tenant informado. */
export async function seedCharge(params: {
  tenantId: string;
  appointmentId?: string | null;
  amountCents?: number;
  status?: "pendente" | "pago" | "expirado" | "cancelado";
  paidAt?: string | null;
  idempotencyKey?: string | null;
  asaasPaymentId?: string | null;
  pixQrCode?: string | null;
  pixCopyPaste?: string | null;
  expiresAt?: string | null;
  gatewayClaimedAt?: string | null;
  gatewayClaimExpiresAt?: string | null;
}): Promise<string> {
  const row: Record<string, unknown> = {
    tenant_id: params.tenantId,
    appointment_id: params.appointmentId ?? null,
    amount_cents: params.amountCents ?? 10_000,
    status: params.status ?? "pendente",
  };
  if (params.paidAt !== undefined) row.paid_at = params.paidAt;
  if (params.idempotencyKey !== undefined) row.idempotency_key = params.idempotencyKey;
  if (params.asaasPaymentId !== undefined) row.asaas_payment_id = params.asaasPaymentId;
  if (params.pixQrCode !== undefined) row.pix_qr_code = params.pixQrCode;
  if (params.pixCopyPaste !== undefined) row.pix_copy_paste = params.pixCopyPaste;
  if (params.expiresAt !== undefined) row.expires_at = params.expiresAt;
  if (params.gatewayClaimedAt !== undefined) row.gateway_claimed_at = params.gatewayClaimedAt;
  if (params.gatewayClaimExpiresAt !== undefined) {
    row.gateway_claim_expires_at = params.gatewayClaimExpiresAt;
  }

  const charge = must(
    "charge",
    await serviceClient().from("charges").insert(row).select("id").single(),
  );
  return charge.id;
}

/** Insere uma linha de recebimento no ledger. */
export async function seedPayment(params: {
  tenantId: string;
  appointmentId: string;
  method?: string;
  amountCents?: number;
  tipCents?: number;
  chargeId?: string | null;
  source?: "manual" | "asaas";
  idempotencyKey?: string | null;
  lineIndex?: number;
  receivedBy?: string | null;
  loteSignature?: string | null;
  voidedAt?: string | null;
  voidedBy?: string | null;
  voidReason?: string | null;
}): Promise<string> {
  const row: Record<string, unknown> = {
    tenant_id: params.tenantId,
    appointment_id: params.appointmentId,
    method: params.method ?? "dinheiro",
    amount_cents: params.amountCents ?? 1_000,
    tip_cents: params.tipCents ?? 0,
    source: params.source ?? "manual",
  };
  if (params.chargeId !== undefined) row.charge_id = params.chargeId;
  if (params.idempotencyKey !== undefined) row.idempotency_key = params.idempotencyKey;
  if (params.lineIndex !== undefined) row.line_index = params.lineIndex;
  if (params.receivedBy !== undefined) row.received_by = params.receivedBy;
  if (params.loteSignature !== undefined) row.lote_signature = params.loteSignature;
  if (params.voidedAt !== undefined) row.voided_at = params.voidedAt;
  if (params.voidedBy !== undefined) row.voided_by = params.voidedBy;
  if (params.voidReason !== undefined) row.void_reason = params.voidReason;

  const payment = must(
    "payment",
    await serviceClient().from("appointment_payments").insert(row).select("id").single(),
  );
  return payment.id;
}

/** Config ativa do Asaas (a master key vem do `.env` das funções). */
export async function seedAsaasConfig(params: {
  tenantId: string;
  encryptedKey: string;
  webhookToken?: string | null;
  active?: boolean;
  environment?: "sandbox" | "production";
}): Promise<void> {
  const row: Record<string, unknown> = {
    tenant_id: params.tenantId,
    asaas_api_key_encrypted: params.encryptedKey,
    active: params.active ?? true,
    environment: params.environment ?? "sandbox",
  };
  if (params.webhookToken !== undefined) row.asaas_webhook_token = params.webhookToken;
  const { error } = await serviceClient().from("tenant_asaas_config").upsert(row);
  if (error) throw new Error(`Fixture tenant_asaas_config falhou (código ${error.code ?? "vazio"}).`);
}

/**
 * Cifra uma API key no formato das Edge Functions (AES-GCM, iv de 12 bytes + ciphertext + tag,
 * base64). A chave é SHA-256 de `ASAAS_MASTER_KEY`, exatamente como `deriveMasterKey()`.
 */
export function encryptAsaasKey(plain: string): string {
  const master = readFunctionsEnv().ASAAS_MASTER_KEY;
  if (!master) throw new Error("ASAAS_MASTER_KEY ausente em supabase/functions/.env.");
  const key = createHash("sha256").update(master).digest();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, ciphertext, tag]).toString("base64");
}

/** Lê o summary único direto da RPC (fonte da verdade dos números). */
export async function readSummary(
  tenantId: string,
  appointmentId: string,
): Promise<Record<string, unknown> | null> {
  const { data, error } = await serviceClient().rpc("appointment_payment_summary", {
    p_tenant_id: tenantId,
    p_appointment_id: appointmentId,
  });
  if (error) throw new Error(`RPC appointment_payment_summary falhou (código ${error.code ?? "vazio"}).`);
  return (data as Record<string, unknown> | null) ?? null;
}

export async function getAppointmentStatus(appointmentId: string): Promise<string | null> {
  const { data, error } = await serviceClient()
    .from("appointments")
    .select("status")
    .eq("id", appointmentId)
    .maybeSingle();
  if (error) throw new Error(`Leitura de appointment falhou (código ${error.code ?? "vazio"}).`);
  return (data?.status as string | undefined) ?? null;
}

/**
 * Apaga os dados do ledger e das cobranças/atendimentos dos tenants informados.
 * Obrigatório antes de `deleteTestUsers()`: as FKs `restrict` do ledger impediriam a remoção
 * de `appointments` e de `profiles`.
 */
export async function cleanupPaymentFixtures(tenantIds: readonly string[]): Promise<void> {
  if (tenantIds.length === 0) return;
  const admin = serviceClient();
  const tenants = [...tenantIds];
  for (const table of ["appointment_payments", "charges", "appointments"] as const) {
    const { error } = await admin.from(table).delete().in("tenant_id", tenants);
    if (error) {
      throw new Error(`Limpeza de ${table} falhou (código ${error.code ?? "sem código"}).`);
    }
  }
}
