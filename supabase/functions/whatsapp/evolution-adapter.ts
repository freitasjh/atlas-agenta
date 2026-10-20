// Adapter Evolution atrás de uma PORTA (interface) — ADR-04.
//
// A integração real com a Evolution API fica desacoplada atrás desta interface. A implementação
// MOCK (QR fake, provider_message_id fake, latência simulada, ZERO rede) segue como fallback
// selecionável por env e intacta (ADR-09 R10/AC-10). A trilha REAL é construída em etapas:
//  - ADR-09: monta a INFRA compartilhada — resolução de credenciais do env, cliente HTTP com
//    `apikey` + timeout (AbortController), schemas zod das respostas não confiáveis da Evolution
//    e normalização determinística do número E.164.
//  - ADR-10: fia `pair` REAL (criar/conectar instância idempotente + QR base64).
//  - ADR-11 (esta): fia `sendText` REAL (envia texto e devolve o `providerMessageId` real).
//
// Seleção por env `EVOLUTION_MODE` (`mock` | `real`, default `mock`). `EVOLUTION_API_URL` /
// `EVOLUTION_API_KEY` só são lidas pela trilha real — segredos vivem em env do servidor, NUNCA
// no bundle do cliente, NUNCA com prefixo VITE_, NUNCA ecoados em log/resposta. A API key da
// Evolution tem o mesmo peso de segredo que a service role key.
//
// Contrato do servidor em uso: Evolution API v2.3.7 (confirmado na análise de dados §5). Em
// v2.3.x o `sendText` usa `text` direto no corpo (versões antigas usavam `textMessage.text`);
// os schemas abaixo refletem v2.3.7 — reconferir a doc se o servidor for atualizado.

import { z } from "npm:zod@3.23.8";

/** Resultado do pareamento de uma instância. QR é efêmero — nunca persistido. */
export interface PairResult {
  /** QR Code em base64 (data URL), exibido na UI; não é guardado no banco. */
  qrCodeBase64: string;
}

/** Resultado do envio de uma mensagem de texto. */
export interface SendResult {
  /** Id do provedor; no mock é um id fake determinístico-por-chamada. */
  providerMessageId: string;
}

export interface SendTextParams {
  instanceName: string;
  /** Número E.164 do destino — lido no servidor, nunca logado em claro. */
  to: string;
  text: string;
}

/** Resultado da checagem de estado da conexão. A porta é dona do formato — não vaza o corpo cru. */
export interface ConnectionStateResult {
  /** Estado real reportado pela Evolution: `open|connecting|close`. */
  state: EvolutionState;
}

/** Porta estável: a Edge Function só conhece esta interface, nunca o provedor concreto. */
export interface EvolutionAdapter {
  pair(instanceName: string): Promise<PairResult>;
  sendText(params: SendTextParams): Promise<SendResult>;
  /**
   * Consulta o estado REAL da conexão da instância (ADR-17). Devolve só o `state` normalizado —
   * nunca o corpo cru da Evolution. Dado externo validado com `connectionStateSchema` na impl
   * real; falha fora do contrato vira `Error` pt-BR, sem vazar corpo nem API key.
   */
  getConnectionState(instanceName: string): Promise<ConnectionStateResult>;
}

// ---------------------------------------------------------------------------
// Infra compartilhada da trilha REAL (ADR-09) — ainda NÃO fiada em pair/sendText.
// ---------------------------------------------------------------------------

/** Timeout das chamadas externas (ngrok pode pendurar) — RNF-RE-06 / R13. */
const EVOLUTION_TIMEOUT_MS = 15_000;

/**
 * Credenciais da Evolution resolvidas do servidor. NUNCA logar/ecoar a `apiKey`.
 */
export interface EvolutionCredentials {
  apiUrl: string;
  apiKey: string;
}

/**
 * Valida a presença das credenciais injetadas (lidas de `Deno.env` por `createEvolutionAdapter`).
 * Se qualquer uma estiver ausente/vazia, lança um `Error` pt-BR explícito SEM efetuar rede
 * (R7/AC-07). O valor da key nunca aparece na mensagem.
 */
export function resolveEvolutionCredentials(
  apiUrl: string | undefined,
  apiKey: string | undefined,
): EvolutionCredentials {
  const url = apiUrl?.trim();
  const key = apiKey?.trim();
  if (!url || !key) {
    throw new Error("Credenciais da Evolution ausentes no servidor.");
  }
  // Remove barras finais para compor caminhos sem barra dupla.
  return { apiUrl: url.replace(/\/+$/, ""), apiKey: key };
}

/** Método HTTP suportado pelas chamadas à Evolution. */
type EvolutionMethod = "GET" | "POST";

interface EvolutionRequestOptions {
  method: EvolutionMethod;
  /** Caminho começando com `/` (ex.: `/instance/connect/tenant-x`). */
  path: string;
  /** Corpo JSON (apenas POST). */
  body?: unknown;
}

/**
 * Resposta HTTP já lida: status + corpo parseado como JSON desconhecido (dado NÃO confiável,
 * validado com zod no ponto de uso). O corpo cru NUNCA é logado — `fetchInstances` carrega
 * `token` por instância (RNF-RE-02).
 */
export interface EvolutionHttpResponse {
  status: number;
  ok: boolean;
  body: unknown;
}

/**
 * Cliente HTTP da Evolution: injeta `apikey` em todas as chamadas, `Content-Type: application/json`
 * nos POSTs, aplica `AbortController` com timeout e traduz timeout/erro de rede em falha pt-BR
 * controlada (R13/AC-13) — nunca exceção crua de `fetch`. Não loga corpo de resposta.
 */
export async function evolutionFetch(
  credentials: EvolutionCredentials,
  options: EvolutionRequestOptions,
): Promise<EvolutionHttpResponse> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), EVOLUTION_TIMEOUT_MS);

  const headers: Record<string, string> = { apikey: credentials.apiKey };
  const init: RequestInit = { method: options.method, headers, signal: controller.signal };
  if (options.method === "POST") {
    headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(options.body ?? {});
  }

  let response: Response;
  try {
    response = await fetch(`${credentials.apiUrl}${options.path}`, init);
  } catch (err) {
    // Timeout (abort) ou erro de rede — motivo técnico curto, SEM corpo nem segredo.
    const reason = err instanceof Error && err.name === "AbortError" ? "timeout" : "network";
    console.error(`evolution: falha de comunicação (${reason})`);
    throw new Error("Falha de comunicação com o servidor de WhatsApp.");
  } finally {
    clearTimeout(timeout);
  }

  // Corpo pode não ser JSON (erro de gateway/ngrok). Tolerar sem vazar o corpo cru.
  let body: unknown = null;
  try {
    const text = await response.text();
    body = text.length > 0 ? JSON.parse(text) : null;
  } catch {
    body = null;
  }

  return { status: response.status, ok: response.ok, body };
}

// ---------------------------------------------------------------------------
// Schemas zod das respostas da Evolution v2.3.7 (dado NÃO confiável — R6/AC-06).
// Validar o shape ANTES de ler qualquer campo; payload fora do contrato vira falha
// controlada pt-BR, nunca exceção crua nem vazamento do corpo do provedor.
// ---------------------------------------------------------------------------

/** Estado da conexão reportado pela Evolution. */
export const evolutionStateSchema = z.enum(["open", "connecting", "close"]);
export type EvolutionState = z.infer<typeof evolutionStateSchema>;

/**
 * `GET /instance/connectionState/{instance}` → `{ instance: { instanceName, state } }`.
 */
export const connectionStateSchema = z.object({
  instance: z.object({
    instanceName: z.string(),
    state: evolutionStateSchema,
  }),
});
export type ConnectionStateResponse = z.infer<typeof connectionStateSchema>;

/**
 * `GET /instance/connect/{instance}` — instância já conectada responde SEM QR, no shape de
 * estado (`{ instance: { instanceName, state } }`).
 */
export const connectStateSchema = connectionStateSchema;

/**
 * `GET /instance/connect/{instance}` — instância aguardando pareamento traz o QR.
 * `base64` normalmente já é data URL; se vier puro, o adapter (ADR-10) prefixa.
 */
export const connectQrSchema = z.object({
  base64: z.string(),
  code: z.string().optional(),
  pairingCode: z.string().nullable().optional(),
  count: z.number().optional(),
});
export type ConnectQrResponse = z.infer<typeof connectQrSchema>;

/**
 * União do `connect`: ou veio o QR (aguardando pareamento) ou o estado (já conectada). A ordem
 * tenta o QR primeiro; o consumidor (ADR-10) decide o comportamento por variante.
 */
export const connectResponseSchema = z.union([connectQrSchema, connectStateSchema]);
export type ConnectResponse = z.infer<typeof connectResponseSchema>;

/**
 * `POST /instance/create` — shape tolerante: confirma criação (`instance`/`hash` presentes) ou
 * carrega uma mensagem de erro. O caso "já existe" (403/409 "name already in use") é detectado
 * pelo status na ADR-10 e tratado como NÃO-fatal (cai no conectar).
 */
export const createInstanceSchema = z.object({
  instance: z
    .object({
      instanceName: z.string().optional(),
      status: z.string().optional(),
    })
    .optional(),
  hash: z.unknown().optional(),
});
export type CreateInstanceResponse = z.infer<typeof createInstanceSchema>;

/**
 * `POST /message/sendText/{instance}` → `{ key: { id, remoteJid?, fromMe? } }`.
 * `providerMessageId` sai de `key.id`.
 */
export const sendTextResponseSchema = z.object({
  key: z.object({
    id: z.string(),
    remoteJid: z.string().optional(),
    fromMe: z.boolean().optional(),
  }),
});
export type SendTextResponse = z.infer<typeof sendTextResponseSchema>;

// ---------------------------------------------------------------------------
// Normalização de número E.164 (helper puro, sem rede — testável isolado).
// ---------------------------------------------------------------------------

/**
 * Normaliza o `to` E.164 (`+55...`, passado pelo `index.ts` a partir de `customer.phone`) para o
 * formato aceito pela Evolution v2 (dígitos, sem `+`). Determinístico e puro. Remove qualquer
 * caractere não-dígito remanescente (espaços, traços) por robustez.
 */
export function normalizePhoneForEvolution(to: string): string {
  return to.replace(/\D+/g, "");
}

// ---------------------------------------------------------------------------
// Helpers de `pair` (ADR-10) — puros, sem rede.
// ---------------------------------------------------------------------------

/**
 * A Evolution responde "nome já em uso" com 403 ou 409 (v2.3.x). Tratar como NÃO-fatal:
 * a instância já existe e o fluxo deve seguir para o conectar (idempotência por nome — R2).
 */
export function isAlreadyExistsStatus(status: number): boolean {
  return status === 403 || status === 409;
}

/**
 * Garante que o QR vá para a UI como data URL renderizável em `<img>`. Em v2.3.7 o `base64`
 * normalmente já vem como `data:image/png;base64,...`; se vier puro, prefixa. Não loga o QR.
 */
export function toQrDataUrl(base64: string): string {
  return base64.startsWith("data:") ? base64 : `data:image/png;base64,${base64}`;
}

// ---------------------------------------------------------------------------
// Mock — único adapter que roda de fato nesta fase. Intacto (R10/AC-10).
// ---------------------------------------------------------------------------

/** PNG 1x1 transparente em base64 — QR fake determinístico, sem acesso de rede. */
const FAKE_QR_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC";

/** Pequena latência simulada para o mock parecer uma chamada remota (sem rede real). */
function simulatedLatency(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 15));
}

/**
 * Implementação MOCK: não faz NENHUMA chamada de rede à Evolution. Devolve um QR fake e um
 * provider_message_id fake. É o único adapter que roda nesta fase.
 */
export class MockEvolutionAdapter implements EvolutionAdapter {
  async pair(_instanceName: string): Promise<PairResult> {
    await simulatedLatency();
    return { qrCodeBase64: `data:image/png;base64,${FAKE_QR_PNG_BASE64}` };
  }

  async sendText(_params: SendTextParams): Promise<SendResult> {
    await simulatedLatency();
    return { providerMessageId: `mock-${crypto.randomUUID()}` };
  }

  /**
   * MOCK: sem rede. Retorna `open` para que o fallback de demo consiga concluir a conexão sem
   * celular/QR real (RF-QR-05).
   */
  async getConnectionState(_instanceName: string): Promise<ConnectionStateResult> {
    await simulatedLatency();
    return { state: "open" };
  }
}

/**
 * Implementação REAL. A infra compartilhada (credenciais, cliente HTTP, schemas, normalização
 * de número) vem da ADR-09. `pair` (ADR-10) e `sendText` (ADR-11) são REAIS. As credenciais
 * chegam via `createEvolutionAdapter()` (lidas do env no servidor) e só são resolvidas/validadas
 * no ponto de uso das operações reais.
 */
export class RealEvolutionAdapter implements EvolutionAdapter {
  // Em `real`, estas vêm de env do servidor (NUNCA do cliente, NUNCA com prefixo VITE_).
  constructor(
    private readonly apiUrl: string | undefined,
    private readonly apiKey: string | undefined,
  ) {}

  /**
   * Resolve e valida as credenciais no ponto de uso (falha cedo e clara, sem rede — R7/AC-07).
   * Usada pelas operações reais `pair` (ADR-10) e `sendText` (ADR-11).
   */
  protected credentials(): EvolutionCredentials {
    return resolveEvolutionCredentials(this.apiUrl, this.apiKey);
  }

  /**
   * `pair` REAL (ADR-10): cria a instância do tenant na Evolution (idempotente por nome) e
   * conecta para obter o QR. O `instanceName` chega já derivado do tenant pelo `index.ts`
   * (`tenant-<tenant_id>`, do JWT) — o adapter NÃO resolve tenant nem toca o banco (RNF-RE-04).
   *
   * Fluxo (contrato v2.3.7 — análise §5):
   *  1. Credenciais do env (sem rede se ausentes — R7/AC-07).
   *  2. `POST /instance/create` ({ instanceName, integration, qrcode: true }). "Já existe"
   *     (403/409) é NÃO-fatal: cai no conectar (idempotência por nome — R2/AC-02). Outros
   *     erros de criação viram falha pt-BR controlada.
   *  3. `GET /instance/connect/{instance}`, resposta validada com zod (dado não confiável):
   *     - traz `base64` → devolve `{ qrCodeBase64 }` como data URL (R3/AC-03);
   *     - `state:"open"` (sem QR) → lança erro pt-BR "já conectado" (D-05 opção b / R4/AC-04).
   *  4. QR e corpo cru da Evolution NUNCA são logados (R8/R9).
   */
  async pair(instanceName: string): Promise<PairResult> {
    const credentials = this.credentials();

    // 1. Criar a instância (idempotente por nome). "Já existe" → não-fatal.
    const createRes = await evolutionFetch(credentials, {
      method: "POST",
      path: "/instance/create",
      body: {
        instanceName,
        integration: "WHATSAPP-BAILEYS",
        qrcode: true,
      },
    });
    if (!createRes.ok && !isAlreadyExistsStatus(createRes.status)) {
      // Erro de criação distinto de "já existe": falha controlada, sem vazar o corpo cru.
      console.error(`pair: criação de instância falhou (status ${createRes.status})`);
      throw new Error("Não foi possível criar a instância do WhatsApp.");
    }

    // 2. Conectar / obter QR. Resposta externa NÃO confiável — validar o shape com zod.
    const connectRes = await evolutionFetch(credentials, {
      method: "GET",
      path: `/instance/connect/${encodeURIComponent(instanceName)}`,
    });
    if (!connectRes.ok) {
      console.error(`pair: conexão da instância falhou (status ${connectRes.status})`);
      throw new Error("Não foi possível conectar o WhatsApp.");
    }

    const parsed = connectResponseSchema.safeParse(connectRes.body);
    if (!parsed.success) {
      console.error("pair: resposta de conexão fora do contrato");
      throw new Error("Resposta inválida do servidor de WhatsApp.");
    }

    const data = parsed.data;
    if ("base64" in data) {
      // Aguardando pareamento: devolve o QR como data URL renderizável. Nunca logar o QR.
      return { qrCodeBase64: toQrDataUrl(data.base64) };
    }

    // `state:"open"` (sem QR): já conectada → erro pt-BR claro (D-05 opção b, interface intacta).
    if (data.instance.state === "open") {
      throw new Error("O WhatsApp já está conectado.");
    }
    // `connecting`/`close` sem QR: estado transitório sem pareamento disponível.
    throw new Error("Não foi possível obter o QR Code do WhatsApp. Tente novamente.");
  }

  /**
   * `sendText` REAL (ADR-11): envia um texto pela instância do tenant e devolve o
   * `providerMessageId` real da Evolution. O `index.ts` já conferiu opt-in LGPD, idempotência
   * (`dedupe_key`) e instância conectada, e grava `messages.provider_message_id` com o retorno
   * — o adapter NÃO toca o banco, NÃO conhece papéis, NÃO resolve tenant (RNF-RE-04).
   *
   * Fluxo (contrato v2.3.7 — análise §5):
   *  1. Credenciais do env (sem rede se ausentes — R7/AC-07).
   *  2. Normaliza o `to` E.164 (`+55...`) para o formato aceito pela Evolution v2 (dígitos,
   *     sem `+`) com o helper puro da ADR-09 (R4/AC-04).
   *  3. `POST /message/sendText/{instance}` com corpo `{ number, text }`, cliente HTTP com
   *     timeout da ADR-09; timeout/erro de rede → falha pt-BR controlada (R13/AC-13).
   *  4. Resposta externa NÃO confiável — validar o shape com zod antes de ler `key.id`; fora do
   *     contrato (sem `key.id`, tipo errado, corpo de erro) → falha pt-BR controlada, SEM vazar
   *     o corpo do provedor (R6/AC-06). O `index.ts` traduz em `send_failed` (502).
   *  5. PII mínima em log: NUNCA logar `to` (telefone) nem `text` (corpo); só motivo técnico
   *     curto (status/categoria). A correlação é por `provider_message_id` (R8/R9/AC-09).
   */
  async sendText(params: SendTextParams): Promise<SendResult> {
    const credentials = this.credentials();
    const number = normalizePhoneForEvolution(params.to);

    const sendRes = await evolutionFetch(credentials, {
      method: "POST",
      path: `/message/sendText/${encodeURIComponent(params.instanceName)}`,
      body: { number, text: params.text },
    });
    if (!sendRes.ok) {
      // Falha de envio distinta de rede/timeout: motivo técnico curto, sem corpo nem PII.
      console.error(`sendText: envio falhou (status ${sendRes.status})`);
      throw new Error("Não foi possível enviar a mensagem pelo WhatsApp.");
    }

    const parsed = sendTextResponseSchema.safeParse(sendRes.body);
    if (!parsed.success) {
      console.error("sendText: resposta de envio fora do contrato");
      throw new Error("Resposta inválida do servidor de WhatsApp.");
    }

    return { providerMessageId: parsed.data.key.id };
  }

  /**
   * `getConnectionState` REAL (ADR-17): consulta o estado atual da instância na Evolution.
   * Porta pura — não toca o banco, não resolve tenant (RNF-RE-04). O consumidor (ADR-18)
   * reconcilia este estado com `whatsapp_instances.connection_status`.
   *
   * Fluxo (contrato v2.3.7 — análise §5):
   *  1. Credenciais do env (sem rede se ausentes — R7/AC-07).
   *  2. `GET /instance/connectionState/{instance}`, cliente HTTP com timeout da ADR-09;
   *     timeout/erro de rede → falha pt-BR controlada (R13/AC-13).
   *  3. Resposta externa NÃO confiável — validar o shape com `connectionStateSchema` antes de
   *     ler `instance.state`; fora do contrato ou `!ok` → falha pt-BR controlada, SEM vazar o
   *     corpo do provedor nem a API key (R6/AC-06, R8/R9).
   */
  async getConnectionState(instanceName: string): Promise<ConnectionStateResult> {
    const credentials = this.credentials();

    const stateRes = await evolutionFetch(credentials, {
      method: "GET",
      path: `/instance/connectionState/${encodeURIComponent(instanceName)}`,
    });
    if (!stateRes.ok) {
      console.error(`getConnectionState: consulta falhou (status ${stateRes.status})`);
      throw new Error("Não foi possível consultar o estado do WhatsApp.");
    }

    const parsed = connectionStateSchema.safeParse(stateRes.body);
    if (!parsed.success) {
      console.error("getConnectionState: resposta de estado fora do contrato");
      throw new Error("Resposta inválida do servidor de WhatsApp.");
    }

    return { state: parsed.data.instance.state };
  }
}

/**
 * Seleciona o adapter por `EVOLUTION_MODE`. Default `mock`. As credenciais da Evolution só são
 * lidas na trilha `real`, resolvidas/validadas no ponto de uso de `pair`/`sendText`.
 */
export function createEvolutionAdapter(): EvolutionAdapter {
  const mode = (Deno.env.get("EVOLUTION_MODE") ?? "mock").toLowerCase();
  if (mode === "real") {
    return new RealEvolutionAdapter(
      Deno.env.get("EVOLUTION_API_URL"),
      Deno.env.get("EVOLUTION_API_KEY"),
    );
  }
  return new MockEvolutionAdapter();
}
