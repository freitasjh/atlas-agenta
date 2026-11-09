/**
 * Mapa de erro pt-BR do canal `functions.invoke("admin-plan")`.
 * Espelha `subscription-errors.ts`: entrada não confiável, leitura defensiva,
 * sem vazar schema nem PII. Inclui PLAN_LIMIT / reason / same_plan.
 */

const PERMISSION_MESSAGE = "Sem permissão para esta ação.";
const NOT_FOUND_MESSAGE = "Empresa não encontrada.";
const INVALID_PAYLOAD_MESSAGE = "Dados inválidos.";
const AUTH_MESSAGE = "Sua sessão expirada. Entre novamente.";
const SAME_PLAN_MESSAGE = "A empresa já está neste plano.";
const GENERIC_MESSAGE = "Não foi possível alterar o plano. Tente novamente.";

function readErrorText(error: unknown): string {
  if (typeof error === "object" && error !== null) {
    const parts: string[] = [];
    if ("status" in error) {
      const value = (error as { status: unknown }).status;
      if (typeof value === "number") parts.push(String(value));
    }
    if ("error" in error) {
      const value = (error as { error: unknown }).error;
      if (typeof value === "string") parts.push(value);
    }
    if ("message" in error) {
      const value = (error as { message: unknown }).message;
      if (typeof value === "string") parts.push(value);
    }
    if (parts.length > 0) return parts.join(" ");
  }
  if (typeof error === "string") return error;
  return "";
}

/**
 * Converte um erro do `functions.invoke` em mensagem pt-BR.
 * PLAN_LIMIT carrega o detalhe do servidor (já pt-BR, sem PII) — repassado.
 * reason curta/longa → Dados inválidos com detalhe de motivo quando presente.
 */
export function mapPlanError(error: unknown): string {
  const text = readErrorText(error);

  if (/\b401\b|unauthorized|jwt|token|sess[aã]o expirou/i.test(text)) {
    return AUTH_MESSAGE;
  }
  if (/\b403\b|forbidden|sem permiss[aã]o|super_admin/i.test(text)) {
    // Troca de senha tem mensagem própria e vem antes do genérico de permissão.
    if (/password_change_required|troque sua senha/i.test(text)) {
      return "Troque sua senha antes de operar o painel.";
    }
    return PERMISSION_MESSAGE;
  }
  if (/PLAN_LIMIT/i.test(text)) {
    // Detalhe já vem pt-BR do servidor ("Limite do plano Individual: ...").
    const match = text.match(/Limite do plano[^]*?(\.|$)/i);
    if (match) return match[0].trim().replace(/\.$/, ".");
    return text.length > 0 && text.length < 300 ? text : "Limite do plano excedido para o destino.";
  }
  if (/same_plan|j[aá] est[aá] neste plano/i.test(text)) {
    return SAME_PLAN_MESSAGE;
  }
  if (/\b409\b/i.test(text)) {
    return SAME_PLAN_MESSAGE;
  }
  if (/\b404\b|not found|n[aã]o encontrad/i.test(text)) {
    return NOT_FOUND_MESSAGE;
  }
  if (/reason_too_short|pelo menos 10/i.test(text)) {
    return "O motivo deve ter pelo menos 10 caracteres.";
  }
  if (/reason_too_long|no m[aá]ximo 280/i.test(text)) {
    return "O motivo deve ter no máximo 280 caracteres.";
  }
  if (/\b400\b|bad request|inv[aá]lid/i.test(text)) {
    return INVALID_PAYLOAD_MESSAGE;
  }

  return GENERIC_MESSAGE;
}
