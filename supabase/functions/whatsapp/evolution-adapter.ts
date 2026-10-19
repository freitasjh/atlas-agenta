// Adapter Evolution atrás de uma PORTA (interface) — ADR-04.
//
// A integração real com a Evolution API fica desacoplada atrás desta interface. A implementação
// MOCK (QR fake, provider_message_id fake, latência simulada, ZERO rede) segue como fallback
// selecionável por env e intacta (ADR-09 R10/AC-10). A trilha REAL é construída em etapas:
//  - ADR-09 (esta): monta a INFRA compartilhada — resolução de credenciais do env, cliente HTTP
//    com `apikey` + timeout (AbortController), schemas zod das respostas não confiáveis da
//    Evolution e normalização determinística do número E.164. `pair`/`sendText` do adapter real
//    CONTINUAM sendo o stub que lança "não implementada nesta fase" — nenhuma chamada real ainda.
//  - ADR-10 / ADR-11: fiam `pair` e `sendText` reais sobre esta base.
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

/** Porta estável: a Edge Function só conhece esta interface, nunca o provedor concreto. */
export interface EvolutionAdapter {
  pair(instanceName: string): Promise<PairResult>;
  sendText(params: SendTextParams): Promise<SendResult>;
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
}

/**
 * Implementação REAL. Na ADR-09 a infra compartilhada (credenciais, cliente HTTP, schemas,
 * normalização de número) já existe acima, mas `pair`/`sendText` CONTINUAM sendo stub — a troca
 * de comportamento é das ADR-10/11. As credenciais chegam via `createEvolutionAdapter()` (lidas
 * do env no servidor) e só são resolvidas/validadas no ponto de uso das operações reais.
 */
export class RealEvolutionAdapter implements EvolutionAdapter {
  // Em `real`, estas vêm de env do servidor (NUNCA do cliente, NUNCA com prefixo VITE_).
  constructor(
    private readonly apiUrl: string | undefined,
    private readonly apiKey: string | undefined,
  ) {}

  /**
   * Resolve e valida as credenciais no ponto de uso (falha cedo e clara, sem rede — R7/AC-07).
   * Fica disponível para as operações reais das ADR-10/11; o stub abaixo ainda não a aciona.
   */
  protected credentials(): EvolutionCredentials {
    return resolveEvolutionCredentials(this.apiUrl, this.apiKey);
  }

  pair(_instanceName: string): Promise<PairResult> {
    throw new Error("Integração real da Evolution não implementada nesta fase.");
  }

  sendText(_params: SendTextParams): Promise<SendResult> {
    throw new Error("Integração real da Evolution não implementada nesta fase.");
  }
}

/**
 * Seleciona o adapter por `EVOLUTION_MODE`. Default `mock`. As credenciais da Evolution só são
 * lidas na trilha `real` — e, nesta fase, só para compor o stub que avisa que não está pronto.
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
