/**
 * Mapa de erro pt-BR do canal de erro do `functions.invoke("admin-subscription")`
 * (ADR-04) → mensagens amigáveis. Espelha o padrão de `whatsapp-errors.ts`:
 * entrada é **dado não confiável** (erro do invoke), lida de forma defensiva,
 * sem vazar schema interno nem PII.
 *
 * Alinhado ao HTTP **409** do gate (Q-04) para transição inválida. As condições
 * são detectadas pelo código HTTP ou por palavras-chave do corpo/mensagem; o
 * shape desconhecido cai no genérico sem lançar.
 */

const PERMISSION_MESSAGE = "Sem permissão para esta ação.";
const TRANSITION_MESSAGE = "Transição de status não permitida.";
const NOT_FOUND_MESSAGE = "Empresa não encontrada.";
const INVALID_PAYLOAD_MESSAGE = "Dados inválidos.";
const AUTH_MESSAGE = "Sua sessão expirou. Entre novamente.";
const GENERIC_MESSAGE =
  "Não foi possível atualizar a assinatura. Tente novamente.";

/**
 * Lê o texto relevante de um erro desconhecido sem assumir o shape. Prefixa um
 * `status` HTTP numérico (quando presente, ex.: `AdminSubscriptionError` do
 * hook) para que a resolução por código funcione mesmo que o corpo não repita o
 * número. Em seguida acrescenta `error`/`message`.
 */
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
 * Converte um erro do `functions.invoke` em mensagem pt-BR. Resolve por código
 * HTTP quando presente no texto e, como reforço, por palavras-chave; fallback
 * seguro no genérico. Não vaza schema nem PII.
 */
export function mapSubscriptionError(error: unknown): string {
  const text = readErrorText(error);

  // 401 antes de 403: "não autorizado" (sessão) vem primeiro.
  if (/\b401\b|unauthorized|jwt|token|sess[aã]o expirou/i.test(text)) {
    return AUTH_MESSAGE;
  }
  if (/\b403\b|forbidden|sem permiss[aã]o|super_admin/i.test(text)) {
    return PERMISSION_MESSAGE;
  }
  if (/\b409\b|transi[cç][aã]o/i.test(text)) {
    return TRANSITION_MESSAGE;
  }
  if (/\b404\b|not found|n[aã]o encontrad/i.test(text)) {
    return NOT_FOUND_MESSAGE;
  }
  if (/\b400\b|bad request|inv[aá]lid/i.test(text)) {
    return INVALID_PAYLOAD_MESSAGE;
  }

  return GENERIC_MESSAGE;
}
