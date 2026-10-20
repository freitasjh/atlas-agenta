// Edge Function `whatsapp` — PRIMEIRA superfície privilegiada do projeto (ADR-04).
//
// Concentra as invariantes caras num ponto testável:
//  - `tenant_id`/`role` derivados do JWT/profiles NO SERVIDOR (nunca do payload — RNF03).
//  - escrita de `messages`/`whatsapp_instances` com SERVICE ROLE (único caminho de escrita de
//    `messages`; o cliente só lê e invoca).
//  - OPT-IN LGPD conferido antes de chamar o provedor; sem consentimento, nada é enviado.
//  - IDEMPOTÊNCIA de envio por `dedupe_key` + índice único parcial no banco (trava sob corrida).
//  - suspensão de disparo quando a assinatura do tenant está `bloqueado`/`cancelado`.
//  - adapter Evolution atrás de PORTA (mock nesta fase) — segredo fora do cliente.
//  - erros por condição com corpo pt-BR; logs SEM PII.
//
// Não há webhook de entrada nesta fase. Nenhum cron/agendador/worker. Só disparo sob demanda.

import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { z } from "npm:zod@3.23.8";
import {
  requestSchema,
  type SendInput,
  type SendResponse,
} from "./schemas.ts";
// `SendResponse` é usado nas assinaturas de `sendResponse()` e nos retornos de condição.
import { createEvolutionAdapter } from "./evolution-adapter.ts";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

/** Resposta JSON pt-BR com status. */
function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function errorResponse(message: string, status: number, extra?: Record<string, unknown>): Response {
  return jsonResponse({ error: message, ...extra }, status);
}

/**
 * Resposta de condição de negócio do `send`: devolve SEMPRE o DTO `SendResponse` no corpo
 * (mesmo com status != 200), para a UI validar com zod e decidir a mensagem pelo `outcome`.
 */
function sendResponse(body: SendResponse, status: number): Response {
  return jsonResponse(body, status);
}

/** Papel do usuário resolvido no servidor a partir de `profiles`. */
type RoleName = "super_admin" | "admin" | "professional" | "receptionist";

interface Identity {
  userId: string;
  tenantId: string | null;
  role: RoleName;
}

interface TenantContext {
  identity: Identity;
  subscriptionStatus: string | null;
}

/** Cria o client com a service role (bypassa RLS) — só no servidor, nunca exposto ao cliente. */
function createServiceClient(): SupabaseClient {
  const url = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceRoleKey) {
    throw new Error("Configuração do servidor ausente (SUPABASE_URL/SERVICE_ROLE_KEY).");
  }
  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * Resolve a identidade a partir do JWT do header Authorization. O `auth.uid()` vem do token
 * validado pelo GoTrue; `tenant_id`/`role` são lidos de `profiles` com service role. NUNCA do
 * payload. Retorna null se o JWT for inválido/ausente.
 */
async function resolveIdentity(
  req: Request,
  service: SupabaseClient,
): Promise<Identity | null> {
  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token) return null;

  const { data: userData, error: userErr } = await service.auth.getUser(token);
  if (userErr || !userData.user) return null;

  const userId = userData.user.id;
  const { data: profile, error: profileErr } = await service
    .from("profiles")
    .select("tenant_id, role")
    .eq("id", userId)
    .maybeSingle();

  if (profileErr || !profile) return null;

  return {
    userId,
    tenantId: profile.tenant_id as string | null,
    role: profile.role as RoleName,
  };
}

/** Lê o status de assinatura do tenant (para suspender disparo em bloqueado/cancelado). */
async function loadTenantContext(
  identity: Identity,
  service: SupabaseClient,
): Promise<TenantContext> {
  if (!identity.tenantId) {
    return { identity, subscriptionStatus: null };
  }
  const { data } = await service
    .from("tenants")
    .select("subscription_status")
    .eq("id", identity.tenantId)
    .maybeSingle();
  return {
    identity,
    subscriptionStatus: (data?.subscription_status as string | null) ?? null,
  };
}

/** Compõe a chave natural de idempotência: template + alvo (agendamento tem precedência). */
function buildDedupeKey(input: SendInput): string {
  const target = input.appointmentId
    ? `a:${input.appointmentId}`
    : `c:${input.customerId}`;
  return `${input.template}:${target}`;
}

// ---------------------------------------------------------------------------
// Operação: parear
// ---------------------------------------------------------------------------
async function handlePair(
  ctx: TenantContext,
  service: SupabaseClient,
): Promise<Response> {
  const { identity } = ctx;
  if (identity.role !== "admin") {
    return errorResponse("Você não tem permissão para parear o WhatsApp.", 403);
  }
  if (!identity.tenantId) {
    return errorResponse("Usuário sem empresa associada.", 403);
  }

  const tenantId = identity.tenantId;
  const instanceName = `tenant-${tenantId}`;
  const adapter = createEvolutionAdapter();

  // Garante a linha da instância do tenant e sinaliza "aguardando_qr" (estado observável).
  const { error: upsertErr } = await service
    .from("whatsapp_instances")
    .upsert(
      {
        tenant_id: tenantId,
        evolution_instance_name: instanceName,
        connection_status: "aguardando_qr",
      },
      { onConflict: "tenant_id" },
    );
  if (upsertErr) {
    console.error("pair: falha ao preparar instância", upsertErr.message);
    return errorResponse("Não foi possível preparar a conexão.", 500);
  }

  // Adapter devolve o QR. QR NÃO é persistido — vive só nesta resposta.
  let qrCodeBase64: string;
  try {
    const pairResult = await adapter.pair(instanceName);
    qrCodeBase64 = pairResult.qrCodeBase64;
  } catch (err) {
    console.error("pair: adapter falhou", err instanceof Error ? err.message : "erro");
    return errorResponse("Falha ao gerar o QR Code da conexão.", 502);
  }

  // `pair` PARA em `aguardando_qr`: a conclusão da conexão passa a ser reconciliada por `check`
  // (handleCheck) condicionada ao `state === "open"` real da Evolution. No modo real, `pair`
  // nunca grava nem retorna `conectado` — o usuário precisa escanear o QR no celular.
  return jsonResponse(
    {
      connection_status: "aguardando_qr",
      qr_code_base64: qrCodeBase64,
    },
    200,
  );
}

// ---------------------------------------------------------------------------
// Operação: check (reconcilia o estado real da Evolution com a linha persistida)
// ---------------------------------------------------------------------------
async function handleCheck(
  ctx: TenantContext,
  service: SupabaseClient,
): Promise<Response> {
  const { identity } = ctx;
  // Parear e reconciliar são atos de configuração do dono do tenant — espelha `handlePair`.
  if (identity.role !== "admin") {
    return errorResponse("Você não tem permissão para verificar a conexão do WhatsApp.", 403);
  }
  if (!identity.tenantId) {
    return errorResponse("Usuário sem empresa associada.", 403);
  }

  const tenantId = identity.tenantId;
  const instanceName = `tenant-${tenantId}`;
  const adapter = createEvolutionAdapter();

  // Consulta o estado REAL da Evolution. Falha é NÃO-fatal: devolve o estado atual da linha.
  let realState: Awaited<ReturnType<typeof adapter.getConnectionState>> | null = null;
  try {
    realState = await adapter.getConnectionState(instanceName);
  } catch (err) {
    // Nunca logar corpo cru/token/QR — só motivo técnico curto.
    console.error("check: adapter falhou", err instanceof Error ? err.message : "erro");
    realState = null;
  }

  // Reconciliação idempotente: só quando a Evolution confirma `open`, transiciona para
  // `conectado` + last_connected_at. Gravar o mesmo `conectado` repetido é inócuo.
  if (realState?.state === "open") {
    const { error: updateErr } = await service
      .from("whatsapp_instances")
      .update({ connection_status: "conectado", last_connected_at: new Date().toISOString() })
      .eq("tenant_id", tenantId);
    if (updateErr) {
      console.error("check: falha ao reconciliar estado", updateErr.message);
      return errorResponse("Não foi possível atualizar o estado da conexão.", 500);
    }
  }

  // Relê a linha e devolve o estado persistido (validável por `checkResponseSchema`).
  const { data: row, error: readErr } = await service
    .from("whatsapp_instances")
    .select("connection_status, last_connected_at")
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (readErr) {
    console.error("check: falha ao reler instância", readErr.message);
    return errorResponse("Não foi possível consultar o estado da conexão.", 500);
  }

  return jsonResponse(
    {
      connection_status: (row?.connection_status as string | null) ?? "desconectado",
      last_connected_at: (row?.last_connected_at as string | null) ?? null,
    },
    200,
  );
}

// ---------------------------------------------------------------------------
// Operação: enviar
// ---------------------------------------------------------------------------
async function handleSend(
  input: SendInput,
  ctx: TenantContext,
  service: SupabaseClient,
): Promise<Response> {
  const { identity, subscriptionStatus } = ctx;
  if (!["admin", "receptionist", "professional"].includes(identity.role)) {
    return errorResponse("Você não tem permissão para enviar mensagens.", 403);
  }
  if (!identity.tenantId) {
    return errorResponse("Usuário sem empresa associada.", 403);
  }
  const tenantId = identity.tenantId;

  // Suspensão por status de assinatura — trava efetiva no servidor (não só na UI).
  if (subscriptionStatus === "bloqueado" || subscriptionStatus === "cancelado") {
    return errorResponse(
      "Os disparos estão suspensos enquanto a assinatura não estiver regularizada.",
      403,
    );
  }

  // Resolve o customer DENTRO do tenant derivado (service role + filtro por tenant_id).
  const { data: customer, error: customerErr } = await service
    .from("customers")
    .select("id, phone, whatsapp_opt_in, active")
    .eq("tenant_id", tenantId)
    .eq("id", input.customerId)
    .maybeSingle();
  if (customerErr) {
    console.error("send: falha ao resolver cliente", customerErr.message);
    return errorResponse("Não foi possível validar o cliente.", 500);
  }
  if (!customer) {
    return errorResponse("Cliente não encontrado nesta empresa.", 404);
  }
  // Cliente inativo (soft-delete) não recebe disparo — coerente com a semântica de `active`.
  if (customer.active === false) {
    return errorResponse("Cliente inativo não pode receber mensagens.", 404);
  }

  const dedupeKey = buildDedupeKey(input);
  const basePayload = {
    template: input.template,
    appointment_id: input.appointmentId ?? null,
  };

  // Opt-in (LGPD): sem consentimento, NÃO chama o provedor. Grava falha (não entra no dedupe).
  if (!customer.whatsapp_opt_in) {
    const { data: failed, error: logErr } = await service
      .from("messages")
      .insert({
        tenant_id: tenantId,
        customer_id: input.customerId,
        appointment_id: input.appointmentId ?? null,
        channel: "whatsapp",
        template: input.template,
        status: "falha",
        failure_reason: "opt_in_ausente",
        payload: basePayload,
        dedupe_key: dedupeKey,
      })
      .select("id")
      .single();
    if (logErr) {
      console.error("send: falha ao registrar bloqueio de opt-in", logErr.message);
    }
    return sendResponse(
      {
        outcome: "opt_out",
        message_id: (failed?.id as string | undefined) ?? null,
        status: "falha",
        provider_message_id: null,
      },
      422,
    );
  }

  // Idempotência: procura disparo vivo com a mesma chave (fila/enviado/entregue).
  const { data: existing, error: existingErr } = await service
    .from("messages")
    .select("id, status, provider_message_id")
    .eq("tenant_id", tenantId)
    .eq("dedupe_key", dedupeKey)
    .in("status", ["fila", "enviado", "entregue"])
    .maybeSingle();
  if (existingErr) {
    console.error("send: falha na checagem de idempotência", existingErr.message);
    return errorResponse("Não foi possível validar o envio.", 500);
  }
  if (existing) {
    return sendResponse(
      {
        outcome: "duplicate",
        message_id: existing.id,
        status: existing.status,
        provider_message_id: existing.provider_message_id ?? null,
      },
      200,
    );
  }

  // Confirma que a instância está conectada antes de enviar.
  const { data: instance } = await service
    .from("whatsapp_instances")
    .select("evolution_instance_name, connection_status")
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (!instance || instance.connection_status !== "conectado") {
    return sendResponse(
      {
        outcome: "not_connected",
        message_id: null,
        status: "falha",
        provider_message_id: null,
      },
      409,
    );
  }

  // Insere em `fila`; o índice único parcial resolve a corrida (2ª invocação lê a vencedora).
  const { data: queued, error: insertErr } = await service
    .from("messages")
    .insert({
      tenant_id: tenantId,
      customer_id: input.customerId,
      appointment_id: input.appointmentId ?? null,
      channel: "whatsapp",
      template: input.template,
      status: "fila",
      payload: basePayload,
      dedupe_key: dedupeKey,
    })
    .select("id")
    .single();

  if (insertErr) {
    // 23505 = unique_violation → corrida de idempotência; relê a linha vencedora.
    if (insertErr.code === "23505") {
      const { data: winner } = await service
        .from("messages")
        .select("id, status, provider_message_id")
        .eq("tenant_id", tenantId)
        .eq("dedupe_key", dedupeKey)
        .in("status", ["fila", "enviado", "entregue"])
        .maybeSingle();
      if (winner) {
        return sendResponse(
          {
            outcome: "duplicate",
            message_id: winner.id,
            status: winner.status,
            provider_message_id: winner.provider_message_id ?? null,
          },
          200,
        );
      }
    }
    console.error("send: falha ao enfileirar mensagem", insertErr.message);
    return errorResponse("Não foi possível registrar o envio.", 500);
  }

  const messageId = queued.id as string;

  // Envia via adapter (mock). `to`/`text` nunca são logados em claro (PII mínima).
  const adapter = createEvolutionAdapter();
  try {
    const sendResult = await adapter.sendText({
      instanceName: instance.evolution_instance_name as string,
      to: customer.phone as string,
      text: input.template,
    });
    await service
      .from("messages")
      .update({ status: "enviado", provider_message_id: sendResult.providerMessageId })
      .eq("id", messageId);
    return sendResponse(
      {
        outcome: "sent",
        message_id: messageId,
        status: "enviado",
        provider_message_id: sendResult.providerMessageId,
      },
      200,
    );
  } catch (err) {
    console.error("send: provedor falhou", err instanceof Error ? err.message : "erro");
    await service
      .from("messages")
      .update({ status: "falha", failure_reason: "provider_error" })
      .eq("id", messageId);
    // Falha de envio é um outcome PRÓPRIO (`send_failed`), distinto de `not_connected` — a UI
    // precisa diferenciar "provedor falhou" de "conecte o WhatsApp". Mantém o DTO no corpo.
    return sendResponse(
      {
        outcome: "send_failed",
        message_id: messageId,
        status: "falha",
        provider_message_id: null,
      },
      502,
    );
  }
}

// ---------------------------------------------------------------------------
// Entrypoint HTTP
// ---------------------------------------------------------------------------
Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return errorResponse("Método não suportado.", 405);
  }

  let service: SupabaseClient;
  try {
    service = createServiceClient();
  } catch (err) {
    console.error("config", err instanceof Error ? err.message : "erro");
    return errorResponse("Erro de configuração do servidor.", 500);
  }

  // Autenticação: JWT obrigatório; tenant/role derivados no servidor.
  const identity = await resolveIdentity(req, service);
  if (!identity) {
    return errorResponse("Sessão inválida ou expirada.", 401);
  }

  // Parse + validação do payload (dado não confiável).
  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return errorResponse("Corpo da requisição inválido.", 400);
  }

  const parsed = requestSchema.safeParse(rawBody);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i: z.ZodIssue) => i.message);
    return errorResponse("Dados inválidos.", 400, { issues });
  }

  const ctx = await loadTenantContext(identity, service);

  try {
    if (parsed.data.action === "pair") {
      return await handlePair(ctx, service);
    }
    if (parsed.data.action === "check") {
      return await handleCheck(ctx, service);
    }
    return await handleSend(parsed.data, ctx, service);
  } catch (err) {
    console.error("handler", err instanceof Error ? err.message : "erro inesperado");
    return errorResponse("Ocorreu um erro inesperado. Tente novamente.", 500);
  }
});
