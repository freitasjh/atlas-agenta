// Envelope HTTP, erros estáveis e log com whitelist (ADR-002 §6.7 e §7).
//
// Regras:
//  * `mapRpcError` traduz SQLSTATE PT4xx + message=CODE em HTTP + código estável;
//  * `23P01` (exclusion_violation de `appointments_no_overlap`) vira 409
//    SLOT_CONFLICT — conflito de horário é erro de negócio, não falha interna;
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
  PACKAGE_CREDIT_AVAILABLE: "Este atendimento tem sessão de pacote disponível. Conclua sem pagamento para usar o pacote.",
  IDEMPOTENCY_CONFLICT: "Lote já registrado com conteúdo diferente.",
  PENDING_CHARGE_EXISTS: "Já existe uma cobrança pendente com outro valor.",
  CHARGE_NOT_PENDING: "Cobrança não está pendente.",
  CHARGE_CANCELLED: "Cobrança cancelada.",
  CHARGE_NOT_APPOINTMENT: "Cobrança não pertence a um atendimento.",
  FISCAL_NOT_FOUND: "Documento fiscal não encontrado.",
  FISCAL_INVALID_STATE: "Estado do documento não permite a operação.",
  FISCAL_ORIGIN_NOT_FOUND: "Origem do documento não encontrada.",
  FISCAL_ORIGIN_DUPLICATE: "Já existe documento fiscal para esta origem.",
  RECEIVABLE_NOT_FOUND: "Conta a receber não encontrada.",
  RECEIVABLE_ALREADY_PAID: "Conta a receber já está quitada.",
  RECEIVABLE_CANCELLED: "Conta a receber cancelada.",
  RECEIVABLE_OVERPAY: "Valor do recebimento excede o saldo da conta.",
  RECEIVABLE_HAS_SETTLEMENTS: "Conta com recebimento registrado não pode ser cancelada.",
  RECEIVABLE_CHARGE_NOT_PENDING: "Cobrança PIX disponível apenas para conta pendente (sem recebimento parcial).",
  RECEIVABLE_HAS_ACTIVE_CHARGE: "Conta com PIX em aberto. Cancele o PIX antes de registrar recebimento ou cancelar a conta.",
  RECEIVABLE_NO_ACTIVE_CHARGE: "Conta sem PIX em aberto para cancelar.",
  RECEIVABLE_CHARGE_CHANGED: "A cobrança mudou durante o cancelamento. Recarregue a conta e tente novamente.",
  BANK_ACCOUNT_NOT_FOUND: "Conta bancária não encontrada.",
  FEATURE_DISABLED: "O recurso de conciliação não está disponível no plano atual.",
  BANK_LINE_NOT_FOUND: "Linha do extrato não encontrada.",
  RECONCILIATION_LINK_NOT_FOUND: "Vínculo de conciliação não encontrado.",
  RECONCILIATION_ALREADY_LINKED: "Esta linha do extrato já está conciliada.",
  RECONCILIATION_TARGET_ALREADY_LINKED: "Este lançamento já está conciliado com outra linha do extrato.",
  RECONCILIATION_LINE_IGNORED: "Linha do extrato ignorada não pode ser conciliada.",
  RECONCILIATION_LINE_RECONCILED: "Linha já conciliada não pode ser ignorada.",
  RECONCILIATION_TARGET_NOT_FOUND: "Lançamento de destino não encontrado.",
  RECONCILIATION_VALUE_MISMATCH: "O valor da linha do extrato difere do lançamento escolhido.",
  RECONCILIATION_ENTRY_UNDO_FORBIDDEN:
    "Este vínculo criou um lançamento. Cancele o lançamento para desfazer.",
  UNDO_REASON_REQUIRED: "Informe o motivo para desfazer após a janela de 5 segundos.",
  SUPPLIER_NOT_FOUND: "Fornecedor não encontrado.",
  CUSTOMER_REQUIRED: "Selecione o cliente do lançamento.",
  STATEMENT_EMPTY: "O arquivo não tem lançamentos.",
  STATEMENT_TOO_MANY_LINES: "O arquivo tem mais lançamentos do que o limite (2.000).",
  STATEMENT_INVALID_DATE: "O arquivo tem uma data inválida.",
  STATEMENT_INVALID_AMOUNT: "O arquivo tem um valor inválido.",
  STATEMENT_INVALID_ROW: "O arquivo tem uma linha incompleta.",
  STATEMENT_INVALID_HEADER:
    "O CSV precisa de cabeçalho com as colunas data, descrição e valor.",
  STATEMENT_UNSUPPORTED_FORMAT: "Formato de arquivo não suportado. Use OFX ou CSV.",
  EMPTY_PERIOD: "Sem movimentos no período. Ajuste o período ou o escopo; nenhum arquivo foi gerado.",
  RANGE_TOO_LARGE: "Período longo demais para exportar. Escolha até 12 meses.",
  WHATSAPP_OPT_IN_REQUIRED: "Cliente sem consentimento de WhatsApp (opt-in). Registre o consentimento antes de cobrar.",
  ASAAS_NOT_CONFIGURED: "Asaas não configurado para esta empresa.",
  GATEWAY_ERROR: "Falha ao criar a cobrança no gateway.",
  GATEWAY_CANCEL_FAILED: "Falha ao cancelar a cobrança no gateway.",
  GATEWAY_IN_PROGRESS: "Cobrança já está sendo criada no gateway. Tente novamente em instantes.",
  GATEWAY_CLAIM_LOST: "O claim da cobrança expirou ou mudou de dono.",
  SEGMENT_NOT_ENABLED: "PDV disponível apenas para salões e barbearias.",
  SERVICE_NOT_OFFERED: "Este profissional não oferece o serviço selecionado.",
  PROFESSIONAL_NOT_AVAILABLE: "Profissional não encontrado ou inativo.",
  SERVICE_NOT_FOUND: "Serviço não encontrado ou inativo.",
  PRODUCT_NOT_FOUND: "Produto não encontrado ou inativo.",
  STOCK_INSUFFICIENT: "Estoque insuficiente para a quantidade solicitada.",
  CUSTOMER_NOT_FOUND: "Cliente não encontrado.",
  SLOT_CONFLICT: "Profissional ocupado neste horário. Escolha outro profissional ou outro horário.",
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
  // SQLSTATE 23P01 (exclusion_violation): a constraint `appointments_no_overlap`
  // barrou sobreposição de agendamento do mesmo profissional. Erro de negócio
  // com mensagem própria — nunca "Erro interno".
  if (rawCode === "23P01") {
    return new ApiError(409, "SLOT_CONFLICT");
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
  "receivable_id",
  "statement_id",
  "line_count",
  "fiscal_document_id",
  "origem_tipo",
  "origem_id",
  "fiscal_status",
  "payment_id",
  "method",
  "amount_cents",
  "tip_cents",
  "code",
  "status",
  "replayed",
  "reason_length",
  "formato",
  "escopo",
  "export_log_id",
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
