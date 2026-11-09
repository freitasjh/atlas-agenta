// Envelope HTTP, erros estáveis e log com whitelist (ADR-002 §6.7 e §7).
//
// Regras:
//  * `mapRpcError` traduz SQLSTATE PT4xx + message=CODE em HTTP + código estável;
//  * qualquer outra falha vira 500 INTERNAL, sem ecoar detalhe de SQL;
//  * `logEvent` só aceita as chaves da whitelist (nunca PII, QR, copia-e-cola ou payload).
import { CORS_HEADERS } from "./http-cors.ts";

export { CORS_HEADERS };

export function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string) {
    super(code);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

const DOMAIN_MESSAGES: Record<string, string> = {
  INVALID_BODY: "Dados inválidos.",
  INVALID_METHOD: "Forma de pagamento inválida.",
  INVALID_AMOUNT: "Valor inválido.",
  IDEMPOTENCY_KEY_REQUIRED: "Chave de idempotência obrigatória.",
  UNAUTHENTICATED: "Sessão inválida ou expirada.",
  FORBIDDEN: "Sem permissão para esta operação.",
  PROFESSIONAL_NOT_OWNER: "Sem permissão para este atendimento.",
  APPOINTMENT_NOT_FOUND: "Atendimento não encontrado.",
  CHARGE_NOT_FOUND: "Cobrança não encontrada.",
  PAYMENT_NOT_FOUND: "Recebimento não encontrado.",
  APPOINTMENT_INVALID_STATE: "Estado do atendimento não permite a operação.",
  APPOINTMENT_ALREADY_CONCLUDED: "Atendimento já concluído.",
  AMOUNT_EXCEEDS_REMAINING: "Valor excede o saldo restante.",
  IDEMPOTENCY_CONFLICT: "Lote já registrado com conteúdo diferente.",
  PENDING_CHARGE_EXISTS: "Já existe uma cobrança pendente com outro valor.",
  CHARGE_NOT_PENDING: "Cobrança não está pendente.",
  CHARGE_CANCELLED: "Cobrança cancelada.",
  CHARGE_NOT_APPOINTMENT: "Cobrança não pertence a um atendimento.",
  ASAAS_NOT_CONFIGURED: "Asaas não configurado para esta empresa.",
  GATEWAY_ERROR: "Falha ao criar a cobrança no gateway.",
  GATEWAY_CANCEL_FAILED: "Falha ao cancelar a cobrança no gateway.",
  GATEWAY_IN_PROGRESS: "Cobrança já está sendo criada no gateway. Tente novamente em instantes.",
  GATEWAY_CLAIM_LOST: "O claim da cobrança expirou ou mudou de dono.",
  SEGMENT_NOT_ENABLED: "PDV disponível apenas para salões e barbearias.",
  SERVICE_NOT_OFFERED: "Este profissional não oferece o serviço selecionado.",
  PROFESSIONAL_NOT_AVAILABLE: "Profissional não encontrado ou inativo.",
  SERVICE_NOT_FOUND: "Serviço não encontrado ou inativo.",
  CUSTOMER_NOT_FOUND: "Cliente não encontrado.",
  METHOD_NOT_ALLOWED: "Método não suportado.",
  INTERNAL: "Erro interno.",
};

export function messageForCode(code: string): string {
  return DOMAIN_MESSAGES[code] ?? "Não foi possível concluir a operação.";
}

/** Converte o erro do PostgREST em `ApiError` de domínio, sem vazar SQL. */
export function mapRpcError(error: { code?: string | null; message?: string | null } | null): ApiError {
  const rawCode = error?.code ?? "";
  const rawMessage = error?.message ?? "";
  if (/^PT\d{3}$/.test(rawCode) && /^[A-Z][A-Z0-9_]{2,63}$/.test(rawMessage)) {
    return new ApiError(Number(rawCode.slice(2)), rawMessage);
  }
  return new ApiError(500, "INTERNAL");
}

export function errorResponse(error: unknown): Response {
  if (error instanceof ApiError) {
    return jsonResponse({ code: error.code, message: messageForCode(error.code) }, error.status);
  }
  return jsonResponse({ code: "INTERNAL", message: messageForCode("INTERNAL") }, 500);
}

/** Campos permitidos em log técnico. Nada fora desta lista chega ao stdout. */
export const LOG_FIELDS = [
  "event",
  "event_id",
  "event_type",
  "tenant_id",
  "actor_id",
  "appointment_id",
  "charge_id",
  "payment_id",
  "method",
  "amount_cents",
  "tip_cents",
  "code",
  "status",
  "replayed",
  "reason_length",
] as const;

export type LogField = (typeof LOG_FIELDS)[number];

export function logEvent(
  event: string,
  fields: Partial<Record<LogField, string | number | boolean | null>> = {},
): void {
  const sanitized: Record<string, string | number | boolean | null> = { event };
  for (const key of LOG_FIELDS) {
    if (key === "event") continue;
    const value = fields[key];
    if (value !== undefined && value !== null) sanitized[key] = value;
  }
  console.log(JSON.stringify(sanitized));
}
