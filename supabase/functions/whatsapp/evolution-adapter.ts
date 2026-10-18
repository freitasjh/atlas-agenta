// Adapter Evolution atrás de uma PORTA (interface) — ADR-04.
//
// A integração real com a Evolution API fica desacoplada atrás desta interface. Nesta fase só
// a implementação MOCK roda (QR fake, provider_message_id fake, latência simulada, ZERO rede) —
// o usuário pediu "mocado por enquanto, depois testamos o envio real" (msgs 11/12). A impl real
// entra na fase seguinte atrás da MESMA interface, sem mexer na Edge Function nem na UI.
//
// Seleção por env `EVOLUTION_MODE` (`mock` | `real`, default `mock`). `EVOLUTION_API_URL` /
// `EVOLUTION_API_KEY` só seriam lidas pela impl real — segredos vivem em env do servidor, NUNCA
// no bundle do cliente. A impl real aqui é um stub que lança "não implementado" nesta fase.

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
 * Stub da impl REAL — nesta fase não é implementada. Mantém o contrato explícito e falha de
 * forma clara caso `EVOLUTION_MODE=real` seja selecionado antes da integração existir.
 */
export class RealEvolutionAdapter implements EvolutionAdapter {
  // Em `real`, estas vêm de env do servidor (NUNCA do cliente, NUNCA com prefixo VITE_).
  constructor(
    private readonly _apiUrl: string | undefined,
    private readonly _apiKey: string | undefined,
  ) {}

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
