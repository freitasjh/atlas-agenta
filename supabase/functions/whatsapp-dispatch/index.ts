// Edge Function `whatsapp-dispatch` — DRENADORA da fila de retentativa (ADR-05, Fatia 2, RNF04).
//
// A Fatia 2 cria mensagens que NASCEM em `status='fila'` sem envio imediato: o `lembrete_d1`
// (ADR-04, enfileirado pelo cron) e o `reagendar_retorno` (ADR-03, enfileirado pelo webhook de
// entrada). A função SQL `whatsapp_process_retry_queue()` (migration 20250223096000) já cuida do
// ESTADO — teto de tentativas (R16) e expiração da janela útil do lembrete (R17). Esta função
// cuida do ENVIO FÍSICO: seleciona as mensagens elegíveis, renderiza o texto no servidor (reusa
// `render.ts` da Fatia 1), chama o adapter Evolution e aplica o BACKOFF no erro.
//
// POR QUE UMA FUNÇÃO SEPARADA (decisão da ADR-02/05): o cron é por função SQL `security definer`
// (sem pg_net, sem service role embutida). O SQL do cron NÃO fala HTTP com a Evolution de forma
// limpa; o segredo da Evolution JAMAIS entra no SQL versionado. O envio físico vive aqui, em Deno,
// atrás do mesmo adapter/porta da Fatia 1 (mock por env; real em fase futura). Em ambiente hosted
// o cron pode invocar esta função via pg_net; sem pg_net/local, ela é invocável manualmente (QA).
//
// BACKOFF (contrato acordado na ADR-05, espelha o cabeçalho da migration 20250223096000): base
// 5 min, fator 3, `max_attempts=3`. No erro de envio: incrementa `attempts`, carimba
// `last_attempt_at=now()`, calcula `next_attempt_at = now() + base * fator^attempts` e MANTÉM
// `status='fila'` (R15). O teto (R16) e a janela (R17) são aplicados pela função SQL antes de a
// mensagem voltar a ser elegível — esta função só reconta o backoff e para quando `attempts`
// chega ao teto (a próxima passada da SQL marca `falha`).
//
// INVARIANTES PRESERVADAS DA FATIA 1:
//  - escrita de `messages` só com SERVICE ROLE (bypassa RLS após o servidor autorizar);
//  - OPT-IN LGPD conferido antes de chamar o provedor — sem consentimento, marca `falha`;
//  - suspensão de disparo quando a assinatura do tenant está `bloqueado`/`cancelado`;
//  - instância do tenant precisa estar `conectado`;
//  - adapter Evolution atrás da PORTA (segredo fora do cliente);
//  - PII mínima em log: `to`/`text`/telefone NUNCA logados em claro.
//
// ISOLAMENTO MULTI-TENANT (RNF03): cada mensagem da fila carrega seu próprio `tenant_id`; todas as
// leituras de customer/instância/tenant são filtradas por esse `tenant_id` da PRÓPRIA linha —
// nunca de parâmetro/cliente. A drenadora é o worker do sistema, não uma sessão de usuário.

import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { createEvolutionAdapter } from "../whatsapp/evolution-adapter.ts";
import {
  DEFAULT_TEMPLATE_BODIES,
  formatDataHora,
  renderTemplate,
  type TemplateKey,
  type TemplateVars,
} from "../whatsapp/render.ts";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// --- Parâmetros de backoff (contrato da ADR-05; espelha a migration 20250223096000) ---
const BACKOFF_BASE_MINUTES = 5;
const BACKOFF_FACTOR = 3;
// Quantidade máxima de mensagens drenadas por invocação — limita o tamanho da passada e o tempo
// de execução da função (um cron de 5 min reprocessa o resto na próxima rodada).
const BATCH_LIMIT = 50;

/** Resposta JSON pt-BR com status. Corpo curto e SEM PII. */
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
 * Próximo instante elegível após uma falha, pelo backoff acordado:
 * `now() + base * fator^attemptsAfter`. `attemptsAfter` é o número de tentativas JÁ FEITAS após
 * este erro (ou seja, o valor já incrementado). Resultado ISO-UTC.
 */
function computeNextAttemptAt(attemptsAfter: number): string {
  const delayMinutes = BACKOFF_BASE_MINUTES * Math.pow(BACKOFF_FACTOR, attemptsAfter - 1);
  const next = new Date(Date.now() + delayMinutes * 60_000);
  return next.toISOString();
}

/** Linha mínima da fila que a drenadora processa. */
interface QueuedMessage {
  id: string;
  tenant_id: string;
  customer_id: string;
  appointment_id: string | null;
  template: TemplateKey;
  attempts: number;
  max_attempts: number;
}

/**
 * Resolve o TEXTO FINAL do template para envio (ADR-04/05): renderização 100% no servidor, dentro
 * do tenant da mensagem (service role). Carrega o body do template ativo do tenant; na ausência
 * usa o texto de sistema padrão da chave (`DEFAULT_TEMPLATE_BODIES`) — NUNCA a chave crua nem
 * vazio. `{nome}`←customer.name, `{servico}`←services.name (só com agendamento),
 * `{dataHora}`←appointments.starts_at no fuso do tenant, `{empresa}`←tenants.trade_name. PII (nome)
 * nunca é logada; o texto renderizado nunca vai a log.
 */
async function resolveRenderedText(
  service: SupabaseClient,
  msg: QueuedMessage,
  customerName: string | null,
): Promise<string> {
  // 1. Body do template ativo do tenant; fallback para o texto de sistema padrão da chave.
  const { data: templateRow } = await service
    .from("message_templates")
    .select("body")
    .eq("tenant_id", msg.tenant_id)
    .eq("template_key", msg.template)
    .eq("active", true)
    .maybeSingle();
  const body = (templateRow?.body as string | undefined)?.trim()
    ? (templateRow!.body as string)
    : DEFAULT_TEMPLATE_BODIES[msg.template];

  // 2. Dados do tenant/empresa e, quando houver agendamento, serviço e data/hora.
  const { data: tenantRow } = await service
    .from("tenants")
    .select("trade_name, legal_name, timezone")
    .eq("id", msg.tenant_id)
    .maybeSingle();
  const timeZone =
    (tenantRow?.timezone as string | null)?.trim() || "America/Sao_Paulo";
  const empresa =
    (tenantRow?.trade_name as string | null)?.trim() ||
    (tenantRow?.legal_name as string | null)?.trim() ||
    null;

  let servico: string | null = null;
  let dataHora: string | null = null;
  if (msg.appointment_id) {
    const { data: appointment } = await service
      .from("appointments")
      .select("starts_at, services(name)")
      .eq("tenant_id", msg.tenant_id)
      .eq("id", msg.appointment_id)
      .maybeSingle();
    if (appointment) {
      const serviceRel = (appointment as { services?: unknown }).services;
      if (Array.isArray(serviceRel)) {
        servico = (serviceRel[0] as { name?: string } | undefined)?.name ?? null;
      } else if (serviceRel && typeof serviceRel === "object") {
        servico = (serviceRel as { name?: string }).name ?? null;
      }
      dataHora = formatDataHora(
        (appointment as { starts_at?: string | null }).starts_at ?? null,
        timeZone,
      );
    }
  }

  const vars: TemplateVars = { nome: customerName, servico, dataHora, empresa };
  return renderTemplate(body, vars);
}

/**
 * Registra uma falha de envio aplicando o backoff: incrementa `attempts`, carimba
 * `last_attempt_at=now()`, calcula o próximo instante elegível e MANTÉM `status='fila'` (R15). O
 * teto/janela são aplicados pela função SQL antes da próxima elegibilidade. `reason` é técnico
 * curto, SEM PII.
 */
async function recordFailureWithBackoff(
  service: SupabaseClient,
  msg: QueuedMessage,
  reason: string,
): Promise<void> {
  const attemptsAfter = msg.attempts + 1;
  const { error } = await service
    .from("messages")
    .update({
      attempts: attemptsAfter,
      last_attempt_at: new Date().toISOString(),
      next_attempt_at: computeNextAttemptAt(attemptsAfter),
      failure_reason: reason,
    })
    .eq("id", msg.id);
  if (error) {
    console.error("dispatch: falha ao registrar backoff", error.message);
  }
}

/**
 * Marca a mensagem como falha DEFINITIVA imediatamente (sem backoff): usada quando reprocessar não
 * adianta (ex.: opt-in ausente). Tira da fila. `reason` técnico curto, sem PII.
 */
async function recordTerminalFailure(
  service: SupabaseClient,
  msg: QueuedMessage,
  reason: string,
): Promise<void> {
  const { error } = await service
    .from("messages")
    .update({
      status: "falha",
      failure_reason: reason,
      last_attempt_at: new Date().toISOString(),
    })
    .eq("id", msg.id);
  if (error) {
    console.error("dispatch: falha ao marcar falha terminal", error.message);
  }
}

/** Resultado agregado de uma passada da drenadora (observabilidade; sem PII). */
interface DispatchSummary {
  processed: number;
  sent: number;
  failed_terminal: number;
  retry_scheduled: number;
}

/**
 * Drena uma passada da fila: seleciona elegíveis, envia e aplica backoff/terminal conforme o
 * resultado. Determinística por invocação; o cron (ou o QA) a chama periodicamente.
 */
async function drainQueue(service: SupabaseClient): Promise<DispatchSummary> {
  const nowIso = new Date().toISOString();
  const summary: DispatchSummary = {
    processed: 0,
    sent: 0,
    failed_terminal: 0,
    retry_scheduled: 0,
  };

  // Elegíveis: em `fila`, dentro do teto e prontas agora (next_attempt_at<=now() ou NULL).
  // `or` cobre o NULL (legado da Fatia 1, que insere sem next_attempt_at) e o backoff pendente.
  // O timestamp vai entre aspas no filtro `or` do PostgREST porque contém `:` (reservado na
  // sintaxe de filtros); `toISOString()` garante sufixo `Z` sem `+`/vírgula/parêntese.
  const { data: rows, error } = await service
    .from("messages")
    .select("id, tenant_id, customer_id, appointment_id, template, attempts, max_attempts")
    .eq("status", "fila")
    .or(`next_attempt_at.is.null,next_attempt_at.lte."${nowIso}"`)
    .order("next_attempt_at", { ascending: true, nullsFirst: true })
    .limit(BATCH_LIMIT);
  if (error) {
    console.error("dispatch: falha ao carregar fila", error.message);
    throw new Error("Não foi possível carregar a fila de retentativa.");
  }

  const queue = (rows ?? []) as QueuedMessage[];
  const adapter = createEvolutionAdapter();

  for (const msg of queue) {
    // Guard de teto: o que já atingiu o limite não é enviado (a função SQL marca `falha`). Pula.
    if (msg.attempts >= msg.max_attempts) continue;
    summary.processed++;

    // Resolve o customer DENTRO do tenant da mensagem (service role + filtro por tenant_id).
    const { data: customer, error: custErr } = await service
      .from("customers")
      .select("name, phone, whatsapp_opt_in, active")
      .eq("tenant_id", msg.tenant_id)
      .eq("id", msg.customer_id)
      .maybeSingle();
    if (custErr) {
      console.error("dispatch: falha ao resolver cliente", custErr.message);
      await recordFailureWithBackoff(service, msg, "customer_lookup_error");
      summary.retry_scheduled++;
      continue;
    }
    // Cliente ausente/inativo ou sem opt-in: falha terminal (reprocessar não muda o consentimento).
    if (!customer || customer.active === false) {
      await recordTerminalFailure(service, msg, "cliente_indisponivel");
      summary.failed_terminal++;
      continue;
    }
    if (!customer.whatsapp_opt_in) {
      await recordTerminalFailure(service, msg, "opt_in_ausente");
      summary.failed_terminal++;
      continue;
    }

    // Suspensão por status de assinatura do tenant — não enviar em bloqueado/cancelado.
    const { data: tenantRow } = await service
      .from("tenants")
      .select("subscription_status")
      .eq("id", msg.tenant_id)
      .maybeSingle();
    const subStatus = (tenantRow?.subscription_status as string | null) ?? null;
    if (subStatus === "bloqueado" || subStatus === "cancelado") {
      // Condição transitória (a assinatura pode regularizar): backoff, não terminal.
      await recordFailureWithBackoff(service, msg, "assinatura_suspensa");
      summary.retry_scheduled++;
      continue;
    }

    // Instância do tenant conectada? (recorte: uma por tenant).
    const { data: instance } = await service
      .from("whatsapp_instances")
      .select("evolution_instance_name, connection_status")
      .eq("tenant_id", msg.tenant_id)
      .maybeSingle();
    if (!instance || instance.connection_status !== "conectado") {
      // Falha temporária típica (RNF04): instância pode reconectar. Backoff.
      await recordFailureWithBackoff(service, msg, "nao_conectado");
      summary.retry_scheduled++;
      continue;
    }

    // Renderiza o texto final (server-side) e envia pelo adapter. `to`/`text` nunca logados.
    const renderedText = await resolveRenderedText(
      service,
      msg,
      (customer.name as string | null) ?? null,
    );
    try {
      const sendResult = await adapter.sendText({
        instanceName: instance.evolution_instance_name as string,
        to: customer.phone as string,
        text: renderedText,
      });
      await service
        .from("messages")
        .update({
          status: "enviado",
          provider_message_id: sendResult.providerMessageId,
          attempts: msg.attempts + 1,
          last_attempt_at: new Date().toISOString(),
        })
        .eq("id", msg.id);
      summary.sent++;
    } catch (err) {
      // Falha temporária de envio: backoff e mantém na fila (R15). O teto fecha nas próximas.
      console.error("dispatch: provedor falhou", err instanceof Error ? err.message : "erro");
      await recordFailureWithBackoff(service, msg, "provider_error");
      summary.retry_scheduled++;
    }
  }

  return summary;
}

// ---------------------------------------------------------------------------
// Entrypoint HTTP — invocável pelo cron (via pg_net no hosted) ou manualmente (QA).
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

  try {
    const summary = await drainQueue(service);
    return jsonResponse({ ok: true, ...summary }, 200);
  } catch (err) {
    console.error("dispatch", err instanceof Error ? err.message : "erro inesperado");
    return jsonResponse({ error: "Ocorreu um erro ao drenar a fila." }, 500);
  }
});
