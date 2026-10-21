// Edge Function `whatsapp-inbound` — PRIMEIRO webhook de ENTRADA do projeto (ADR-03, Fatia 2).
//
// A Evolution API chama esta URL PÚBLICA (sem JWT de usuário) quando o cliente responde ao
// lembrete D-1 no WhatsApp. É a maior superfície de risco da fatia; por isso a ordem do fluxo é
// RÍGIDA — autenticidade → schema → idempotência → resolução/efeito — e nenhum efeito acontece
// antes dos três primeiros passos:
//
//  - AUTENTICIDADE (R5): segredo compartilhado `WHATSAPP_WEBHOOK_SECRET`, comparado em TEMPO
//    CONSTANTE (a Evolution v2.3.x não assina HMAC por padrão). Sem match → 401, nenhum efeito.
//  - SCHEMA (R6): corpo validado com zod (dado não confiável); falhou → 400, nenhum efeito.
//  - IDEMPOTÊNCIA (R7): grava `webhook_events` cedo; a 2ª gravação do MESMO `external_event_id`
//    viola o índice único `(source, external_event_id)` (23505) e o processamento PARA antes de
//    qualquer efeito.
//  - ISOLAMENTO (R12/RNF03): o `tenant_id` vem SEMPRE da instância
//    (`whatsapp_instances.evolution_instance_name → tenant_id`), NUNCA do payload. O casamento
//    resposta→agendamento é restrito a esse tenant.
//  - PII MÍNIMA (R19): `webhook_events.payload` e logs NÃO guardam telefone, documento nem o
//    texto cru. O número é usado só em memória para o casamento.
//
// Servida SEM verificação de JWT do Supabase (`verify_jwt = false` em config.toml) — a
// autenticidade é feita pelo segredo compartilhado, não pelo GoTrue. Segredo vive só em env/secret
// do servidor; nunca no bundle, nunca `VITE_*`.

import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { z } from "npm:zod@3.23.8";
import {
  extractInboundText,
  extractSenderNumber,
  inboundEventSchema,
  type InboundEvent,
  parseIntent,
  type ParsedIntent,
} from "./schemas.ts";
// Reuso do helper puro de normalização E.164-BR (ADR-01, dona da regra): garante que o número do
// remetente case com `customers.phone` normalizado, cobrindo legados sem DDI. Import cruzado do
// módulo irmão — `deno check` resolve pelo caminho relativo.
import { normalizePhoneForEvolution } from "../whatsapp/evolution-adapter.ts";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-webhook-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

/** Resposta JSON pt-BR com status. Corpo sempre curto e SEM PII. */
function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
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
 * Comparação em TEMPO CONSTANTE de dois segredos (evita timing attack na autenticidade do
 * webhook, R5). Compara byte a byte sobre os dois buffers; comprimentos diferentes também são
 * tratados em tempo ~constante usando o maior comprimento como base e acumulando a diferença.
 */
function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const bufA = enc.encode(a);
  const bufB = enc.encode(b);
  const len = Math.max(bufA.length, bufB.length);
  let diff = bufA.length ^ bufB.length;
  for (let i = 0; i < len; i++) {
    diff |= (bufA[i] ?? 0) ^ (bufB[i] ?? 0);
  }
  return diff === 0;
}

/**
 * Lê o segredo do webhook de um dos cabeçalhos aceitos (`x-webhook-secret` próprio ou `apikey`,
 * que a Evolution permite configurar na borda) OU do query param `?token=` da URL registrada na
 * instância. Retorna null se nenhum vier.
 */
function readPresentedSecret(req: Request): string | null {
  const header =
    req.headers.get("x-webhook-secret") ?? req.headers.get("apikey");
  if (header && header.trim() !== "") return header.trim();
  try {
    const token = new URL(req.url).searchParams.get("token");
    if (token && token.trim() !== "") return token.trim();
  } catch {
    // URL malformada: ignora o query param.
  }
  return null;
}

/** Metadados SEM PII persistidos em `webhook_events.payload` (R19). */
interface EventMeta {
  instance_name: string;
  event?: string;
  message_ts?: number | string;
}

/**
 * Grava uma linha de `webhook_events`. Usada em todos os desfechos auditáveis. NÃO inclui
 * telefone, documento nem o texto cru (PII mínima — R19). Retorna o código de erro do Postgres
 * (ex.: 23505 de colisão no índice único de dedupe) quando houver, para o chamador decidir.
 */
async function insertWebhookEvent(
  service: SupabaseClient,
  row: {
    tenant_id: string | null;
    external_event_id: string;
    instance_name: string;
    status: "recebido" | "processado" | "ignorado" | "rejeitado";
    parsed_intent?: ParsedIntent | null;
    appointment_id?: string | null;
    payload?: Record<string, unknown>;
    failure_reason?: string | null;
  },
): Promise<{ error: { code?: string; message: string } | null }> {
  // `tenant_id` é NOT NULL na tabela; só gravamos quando já resolvido. Eventos sem tenant
  // (instância órfã, auth/schema sem instância legível) são apenas logados, não persistidos.
  if (!row.tenant_id) {
    return { error: null };
  }
  const { error } = await service.from("webhook_events").insert({
    tenant_id: row.tenant_id,
    source: "evolution",
    external_event_id: row.external_event_id,
    instance_name: row.instance_name,
    status: row.status,
    parsed_intent: row.parsed_intent ?? null,
    appointment_id: row.appointment_id ?? null,
    payload: row.payload ?? {},
    failure_reason: row.failure_reason ?? null,
  });
  return { error };
}

/**
 * Atualiza o desfecho de um `webhook_events` já criado (passo 5). Mantém a linha única por
 * evento: o update carimba o resultado do processamento (processado/ignorado + intenção +
 * agendamento casado). Idempotente por natureza (uma linha por `external_event_id`).
 */
async function finalizeWebhookEvent(
  service: SupabaseClient,
  tenantId: string,
  externalEventId: string,
  patch: {
    status: "processado" | "ignorado";
    parsed_intent?: ParsedIntent | null;
    appointment_id?: string | null;
    failure_reason?: string | null;
  },
): Promise<void> {
  const { error } = await service
    .from("webhook_events")
    .update({
      status: patch.status,
      parsed_intent: patch.parsed_intent ?? null,
      appointment_id: patch.appointment_id ?? null,
      failure_reason: patch.failure_reason ?? null,
    })
    .eq("tenant_id", tenantId)
    .eq("source", "evolution")
    .eq("external_event_id", externalEventId);
  if (error) {
    console.error("inbound: falha ao finalizar webhook_event", error.message);
  }
}

interface MatchedAppointment {
  id: string;
  status: string;
  customerId: string;
  optIn: boolean;
}

/**
 * Casa a resposta recebida a um agendamento do tenant (R8/R12). Determinístico:
 *  - cliente do tenant cujo `phone` normalizado == número do remetente normalizado;
 *  - agendamento `status in ('pendente','confirmado')`, `starts_at` no futuro;
 *  - que teve `lembrete_d1` enviado/entregue (há `messages` com esse template e appointment_id);
 *  - escolhe o de `starts_at` MAIS PRÓXIMO.
 * Retorna null se nada casar (R8 → evento `ignorado`, sem efeito). Filtra SEMPRE por tenant.
 */
async function matchAppointment(
  service: SupabaseClient,
  tenantId: string,
  senderNumberNormalized: string,
): Promise<MatchedAppointment | null> {
  // 1. Clientes do tenant com opt-in. Normaliza `phone` de cada um e compara (legados podem
  //    estar sem DDI no banco; a normalização cobre). PII (phone) só em memória, nunca logada.
  const { data: customers, error: custErr } = await service
    .from("customers")
    .select("id, phone, whatsapp_opt_in")
    .eq("tenant_id", tenantId);
  if (custErr) {
    console.error("inbound: falha ao carregar clientes", custErr.message);
    return null;
  }
  const matchedCustomers = (customers ?? []).filter((c) => {
    const phone = (c.phone as string | null) ?? "";
    if (!phone) return false;
    return normalizePhoneForEvolution(phone) === senderNumberNormalized;
  });
  if (matchedCustomers.length === 0) return null;

  const customerIds = matchedCustomers.map((c) => c.id as string);
  const optInById = new Map<string, boolean>(
    matchedCustomers.map((c) => [c.id as string, Boolean(c.whatsapp_opt_in)]),
  );

  const nowIso = new Date().toISOString();

  // 2. Agendamentos elegíveis desses clientes, no tenant, futuros e em estado confirmável,
  //    ordenados pelo starts_at mais próximo.
  const { data: appts, error: apptErr } = await service
    .from("appointments")
    .select("id, status, customer_id, starts_at")
    .eq("tenant_id", tenantId)
    .in("customer_id", customerIds)
    .in("status", ["pendente", "confirmado"])
    .gt("starts_at", nowIso)
    .order("starts_at", { ascending: true });
  if (apptErr) {
    console.error("inbound: falha ao carregar agendamentos", apptErr.message);
    return null;
  }
  if (!appts || appts.length === 0) return null;

  // 3. Dentre os candidatos (já ordenados por proximidade), o primeiro que teve `lembrete_d1`
  //    enviado/entregue. Checa por agendamento para não casar resposta a algo nunca lembrado.
  for (const appt of appts) {
    const apptId = appt.id as string;
    const { data: reminder } = await service
      .from("messages")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("appointment_id", apptId)
      .eq("template", "lembrete_d1")
      .in("status", ["enviado", "entregue"])
      .limit(1)
      .maybeSingle();
    if (reminder) {
      const customerId = appt.customer_id as string;
      return {
        id: apptId,
        status: appt.status as string,
        customerId,
        optIn: optInById.get(customerId) ?? false,
      };
    }
  }
  return null;
}

/**
 * Aplica a confirmação (resposta "1", R9/R13). Grava `status='confirmado'` + `confirmed_via=
 * 'cliente_whatsapp'` numa só instrução — o trigger `appointments_transition_guard` valida só
 * `status` e carimba `confirmed_at`; `confirmed_via` passa junto. Transição inválida (23514)
 * para agendamento já `cancelado`/`concluido` é tratada sem quebrar (R13). Se já está
 * `confirmado`, só carimba a origem sem reentrar no trigger.
 */
async function applyConfirm(
  service: SupabaseClient,
  tenantId: string,
  appointment: MatchedAppointment,
): Promise<{ ok: boolean; failureReason: string | null }> {
  if (appointment.status === "confirmado") {
    // Reconfirmação: não mexe no status (não reentra no trigger); só carimba a origem se faltar.
    const { error } = await service
      .from("appointments")
      .update({ confirmed_via: "cliente_whatsapp" })
      .eq("tenant_id", tenantId)
      .eq("id", appointment.id)
      .neq("confirmed_via", "cliente_whatsapp");
    if (error) {
      console.error("inbound: falha ao carimbar origem de confirmação", error.message);
      return { ok: false, failureReason: "update_error" };
    }
    return { ok: true, failureReason: null };
  }

  const { error } = await service
    .from("appointments")
    .update({ status: "confirmado", confirmed_via: "cliente_whatsapp" })
    .eq("tenant_id", tenantId)
    .eq("id", appointment.id);
  if (error) {
    // 23514 = check_violation: transição inválida levantada pelo trigger (ex.: agendamento já
    // cancelado/concluido entre o casamento e o update). NÃO quebra a função (R13) — registra e
    // segue; o desfecho é 'processado' com motivo técnico curto.
    if (error.code === "23514") {
      return { ok: false, failureReason: "transicao_invalida" };
    }
    console.error("inbound: falha ao confirmar agendamento", error.message);
    return { ok: false, failureReason: "update_error" };
  }
  return { ok: true, failureReason: null };
}

/**
 * Enfileira a mensagem automática de retorno (resposta "2", R10/R14). NÃO altera o agendamento.
 * Mesma disciplina do `handleSend` da Fatia 1: respeita opt-in e idempotência por `dedupe_key`.
 * Deixa em `status='fila'`; quem ENVIA de fato é o worker de retentativa (ADR-05) — mantém a
 * função de entrada rápida e uniformiza o caminho de envio (latência de até 1 ciclo do worker).
 */
async function enqueueReagendarRetorno(
  service: SupabaseClient,
  tenantId: string,
  appointment: MatchedAppointment,
): Promise<void> {
  const dedupeKey = `reagendar_retorno:a:${appointment.id}`;
  const basePayload = {
    template: "reagendar_retorno",
    appointment_id: appointment.id,
    origin: "inbound_reagendar",
  };

  // Opt-in (LGPD): sem consentimento, não enfileira — registra falha (não entra no dedupe vivo),
  // espelhando o padrão do handleSend.
  if (!appointment.optIn) {
    const { error } = await service.from("messages").insert({
      tenant_id: tenantId,
      customer_id: appointment.customerId,
      appointment_id: appointment.id,
      channel: "whatsapp",
      template: "reagendar_retorno",
      status: "falha",
      failure_reason: "opt_in_ausente",
      payload: basePayload,
      dedupe_key: dedupeKey,
    });
    if (error && error.code !== "23505") {
      console.error("inbound: falha ao registrar bloqueio de opt-in (reagendar)", error.message);
    }
    return;
  }

  // Idempotência de envio: já há um disparo vivo com a mesma chave? Não duplica.
  const { data: existing } = await service
    .from("messages")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("dedupe_key", dedupeKey)
    .in("status", ["fila", "enviado", "entregue"])
    .maybeSingle();
  if (existing) return;

  const { error } = await service.from("messages").insert({
    tenant_id: tenantId,
    customer_id: appointment.customerId,
    appointment_id: appointment.id,
    channel: "whatsapp",
    template: "reagendar_retorno",
    status: "fila",
    payload: basePayload,
    dedupe_key: dedupeKey,
    attempts: 0,
    next_attempt_at: new Date().toISOString(),
  });
  if (error && error.code !== "23505") {
    // 23505 = corrida de idempotência (outra invocação enfileirou primeiro): inócuo.
    console.error("inbound: falha ao enfileirar reagendar_retorno", error.message);
  }
}

// ---------------------------------------------------------------------------
// Entrypoint HTTP — ordem rígida: auth → schema → idempotência → resolução/efeito.
// ---------------------------------------------------------------------------
Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Método não suportado." }, 405);
  }

  let service: SupabaseClient;
  try {
    service = createServiceClient();
  } catch (err) {
    console.error("config", err instanceof Error ? err.message : "erro");
    return jsonResponse({ error: "Erro de configuração do servidor." }, 500);
  }

  // === 1. AUTENTICIDADE (R5) — antes de qualquer leitura de corpo/negócio. ===
  const expectedSecret = Deno.env.get("WHATSAPP_WEBHOOK_SECRET");
  if (!expectedSecret || expectedSecret.trim() === "") {
    // Sem segredo configurado no servidor: recusa tudo (falha fechada). Não vaza configuração.
    console.error("inbound: WHATSAPP_WEBHOOK_SECRET ausente no servidor");
    return jsonResponse({ error: "Não autorizado." }, 401);
  }
  const presented = readPresentedSecret(req);
  if (!presented || !timingSafeEqual(presented, expectedSecret)) {
    // Para registrar `rejeitado` precisaríamos de tenant + external_event_id, que só saem do
    // corpo (ainda não lido/validado) e da instância. Como a tabela exige tenant_id NOT NULL e o
    // tenant só é resolvido pela instância APÓS validar o schema, aqui apenas logamos e negamos.
    console.error("inbound: autenticidade recusada");
    return jsonResponse({ error: "Não autorizado." }, 401);
  }

  // === 2. SCHEMA (R6) — corpo é dado não confiável; validar com zod. ===
  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return jsonResponse({ error: "Corpo da requisição inválido." }, 400);
  }
  const parsed = inboundEventSchema.safeParse(rawBody);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i: z.ZodIssue) => i.message);
    return jsonResponse({ error: "Dados inválidos.", issues }, 400);
  }
  const event: InboundEvent = parsed.data;
  const externalEventId = event.data.key.id;
  const instanceName = event.instance;
  const meta: EventMeta = {
    instance_name: instanceName,
    event: event.event,
    message_ts: event.data.messageTimestamp,
  };

  try {
    // Eco da própria instância ou mensagem sem texto: nada a fazer. Não há efeito nem dedupe
    // relevante — respondemos 200 para a Evolution não reentregar.
    if (event.data.key.fromMe === true) {
      return jsonResponse({ ok: true, outcome: "ignorado" }, 200);
    }

    // === 3b. Resolver tenant PELA INSTÂNCIA (nunca do payload — R12/RNF03). ===
    const { data: instanceRow, error: instErr } = await service
      .from("whatsapp_instances")
      .select("tenant_id")
      .eq("evolution_instance_name", instanceName)
      .maybeSingle();
    if (instErr) {
      console.error("inbound: falha ao resolver instância", instErr.message);
      return jsonResponse({ error: "Erro ao processar o evento." }, 500);
    }
    const tenantId = (instanceRow?.tenant_id as string | null) ?? null;
    if (!tenantId) {
      // Instância órfã (nenhum tenant): não dá para gravar webhook_events (tenant_id NOT NULL).
      // Apenas loga e responde 200 (sem efeito, sem erro ao provedor — R8).
      console.error("inbound: instância sem tenant associado");
      return jsonResponse({ ok: true, outcome: "ignorado" }, 200);
    }

    // === 3. IDEMPOTÊNCIA (R7) — gravar o evento ANTES de qualquer efeito. ===
    // A 2ª gravação do mesmo (source, external_event_id) viola o índice único (23505): é
    // reprocessamento → parar antes do efeito e responder 200.
    const inserted = await insertWebhookEvent(service, {
      tenant_id: tenantId,
      external_event_id: externalEventId,
      instance_name: instanceName,
      status: "recebido",
      payload: meta as unknown as Record<string, unknown>,
    });
    if (inserted.error) {
      if (inserted.error.code === "23505") {
        // Evento repetido: idempotência garantida. Nenhum efeito repetido.
        return jsonResponse({ ok: true, outcome: "duplicado" }, 200);
      }
      console.error("inbound: falha ao registrar evento", inserted.error.message);
      return jsonResponse({ error: "Erro ao processar o evento." }, 500);
    }

    // Sem texto (mídia, evento vazio): registra ignorado e segue.
    const text = extractInboundText(event);
    if (!text) {
      await finalizeWebhookEvent(service, tenantId, externalEventId, {
        status: "ignorado",
        failure_reason: "sem_texto",
      });
      return jsonResponse({ ok: true, outcome: "ignorado" }, 200);
    }

    // Remetente ausente/grupo: sem como casar.
    const senderNumber = extractSenderNumber(event);
    if (!senderNumber) {
      await finalizeWebhookEvent(service, tenantId, externalEventId, {
        status: "ignorado",
        failure_reason: "remetente_ausente",
      });
      return jsonResponse({ ok: true, outcome: "ignorado" }, 200);
    }

    // === 3c. Status de assinatura: bloqueado/cancelado suspende efeito de negócio. ===
    const { data: tenantRow } = await service
      .from("tenants")
      .select("subscription_status")
      .eq("id", tenantId)
      .maybeSingle();
    const subscriptionStatus = (tenantRow?.subscription_status as string | null) ?? null;
    if (subscriptionStatus === "bloqueado" || subscriptionStatus === "cancelado") {
      await finalizeWebhookEvent(service, tenantId, externalEventId, {
        status: "ignorado",
        failure_reason: "assinatura_suspensa",
      });
      return jsonResponse({ ok: true, outcome: "ignorado" }, 200);
    }

    // === 3d. Interpretar a intenção (texto numérico). ===
    const intent = parseIntent(text);
    if (intent === "nao_reconhecido") {
      // R11: texto que não casa 1/2 — registra ignorado, sem efeito e sem resposta automática.
      await finalizeWebhookEvent(service, tenantId, externalEventId, {
        status: "ignorado",
        parsed_intent: "nao_reconhecido",
      });
      return jsonResponse({ ok: true, outcome: "ignorado" }, 200);
    }

    // === 4. CASAR resposta → agendamento (R8/R12), restrito ao tenant da instância. ===
    const senderNormalized = normalizePhoneForEvolution(senderNumber);
    const appointment = await matchAppointment(service, tenantId, senderNormalized);
    if (!appointment) {
      // Nenhum agendamento elegível: ignorado, sem efeito, sem erro ao provedor (R8).
      await finalizeWebhookEvent(service, tenantId, externalEventId, {
        status: "ignorado",
        parsed_intent: intent,
      });
      return jsonResponse({ ok: true, outcome: "ignorado" }, 200);
    }

    // === 5. EFEITO. ===
    if (intent === "confirmar") {
      const result = await applyConfirm(service, tenantId, appointment);
      await finalizeWebhookEvent(service, tenantId, externalEventId, {
        status: "processado",
        parsed_intent: "confirmar",
        appointment_id: appointment.id,
        failure_reason: result.failureReason,
      });
      return jsonResponse({ ok: true, outcome: "processado" }, 200);
    }

    // intent === "reagendar" (R10/R14): não altera o agendamento; enfileira retorno.
    await enqueueReagendarRetorno(service, tenantId, appointment);
    await finalizeWebhookEvent(service, tenantId, externalEventId, {
      status: "processado",
      parsed_intent: "reagendar",
      appointment_id: appointment.id,
    });
    return jsonResponse({ ok: true, outcome: "processado" }, 200);
  } catch (err) {
    console.error("inbound: erro inesperado", err instanceof Error ? err.message : "erro");
    return jsonResponse({ error: "Ocorreu um erro inesperado." }, 500);
  }
});
