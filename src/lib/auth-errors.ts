import { AuthError } from "@supabase/supabase-js";

/**
 * Mapeia erros do Supabase Auth para mensagens de usuário em pt-BR
 * (analysis-frontend §5). As mensagens são deliberadamente genéricas em casos
 * sensíveis (credencial inválida) para NÃO revelar se um e-mail existe.
 *
 * Logs técnicos ficam em inglês e nunca carregam senha/credencial (PII).
 */

/** Mensagem neutra padrão quando a causa não é reconhecida. */
const FALLBACK_MESSAGE = "Algo deu errado. Tente novamente.";

/** Mensagem de falha de conexão/rede. */
const NETWORK_MESSAGE =
  "Não foi possível concluir. Verifique a conexão e tente de novo.";

/**
 * Converte um erro arbitrário (normalmente `AuthError` do Supabase) em texto
 * pt-BR adequado para exibir num `FormMessage`/alerta. Nunca lança.
 */
export function mapAuthError(error: unknown): string {
  if (!(error instanceof AuthError)) {
    if (isNetworkError(error)) return NETWORK_MESSAGE;
    return FALLBACK_MESSAGE;
  }

  // Falhas transitórias de rede chegam como AuthRetryableFetchError.
  if (error.name === "AuthRetryableFetchError") return NETWORK_MESSAGE;

  const code = error.code;

  switch (code) {
    case "invalid_credentials":
    case "invalid_grant":
      // Genérico: não revela qual campo errou (anti-enumeração).
      return "E-mail ou senha incorretos.";
    case "user_already_exists":
    case "email_exists":
      return "Já existe uma conta com esse e-mail.";
    case "weak_password":
      return "A senha deve ter ao menos 8 caracteres.";
    case "over_request_rate_limit":
    case "over_email_send_rate_limit":
      return "Muitas tentativas. Aguarde um instante e tente de novo.";
    case "session_not_found":
    case "flow_state_not_found":
    case "flow_state_expired":
      return "O link é inválido ou expirou. Solicite um novo.";
    default:
      return FALLBACK_MESSAGE;
  }
}

/** Heurística simples para detectar falha de rede fora do AuthError. */
function isNetworkError(error: unknown): boolean {
  // `String(error)` alimenta só o classificador, nunca um texto exibido: a
  // mensagem do servidor não vai para a tela (ADR-09, critério 3).
  return error instanceof TypeError && /fetch|network/i.test(String(error));
}

/* -------------------------------------------------------------------------- */
/* Troca de senha obrigatória (ADR-09)                                        */
/* -------------------------------------------------------------------------- */

/**
 * Mensagens da tela de troca (ADR-09, tabela de erros). São as ÚNICAS strings
 * que chegam ao `role="alert"` da tela — a mensagem do servidor nunca é exibida.
 */
const INITIAL_SESSION_EXPIRED_MESSAGE = "Sua sessão expirou. Entre novamente.";
const INITIAL_PASSWORD_IS_INITIAL_MESSAGE =
  "Escolha uma senha diferente da atual.";
const INITIAL_PASSWORD_TOO_SHORT_MESSAGE =
  "A senha deve ter ao menos 8 caracteres.";
const INITIAL_PASSWORD_TOO_LONG_MESSAGE =
  "A senha deve ter no máximo 72 bytes.";
const INITIAL_PASSWORD_CHANGE_IN_PROGRESS_MESSAGE =
  "Aguarde e tente novamente.";
const INITIAL_PASSWORD_GENERIC_MESSAGE =
  "Não foi possível salvar a nova senha. Tente novamente.";

/** Códigos estáveis da Edge Function `change-password` (ADR-04). */
const UNAUTHENTICATED_CODE = "unauthenticated";
const PASSWORD_IS_INITIAL_CODE = "password_is_initial";
const PASSWORD_TOO_SHORT_CODE = "password_too_short";
const PASSWORD_TOO_LONG_CODE = "password_too_long";
const PASSWORD_CHANGE_IN_PROGRESS_CODE = "password_change_in_progress";
const PASSWORD_CHANGE_SUPERSEDED_CODE = "password_change_superseded";

/**
 * Lê o status HTTP do erro. Cobre os três shapes reais: erro normalizado pelo
 * hook (`{ status }`), `FunctionsHttpError` (`{ context: Response }`) e objetos
 * com `statusCode`. Sem status ⇒ `null` (nunca lança).
 */
function readErrorStatus(error: unknown): number | null {
  if (typeof error !== "object" || error === null) return null;

  const record = error as Record<string, unknown>;
  for (const key of ["status", "statusCode"] as const) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }

  const context = record.context;
  if (typeof context === "object" && context !== null) {
    const status = (context as Record<string, unknown>).status;
    if (typeof status === "number" && Number.isFinite(status)) return status;
  }

  return null;
}

/**
 * Lê o código estável (`{ code }`, ou `{ error }` do canal de erro, ou
 * `{ body: { code } }`) sem tocar em `message`. Código desconhecido ⇒ `null`.
 */
function readErrorCode(error: unknown): string | null {
  if (typeof error !== "object" || error === null) return null;

  const record = error as Record<string, unknown>;
  for (const key of ["code", "error"] as const) {
    const value = record[key];
    if (typeof value === "string") return value;
  }

  const body = record.body;
  if (typeof body === "object" && body !== null) {
    const code = (body as Record<string, unknown>).code;
    if (typeof code === "string") return code;
  }

  return null;
}

/**
 * Códigos de issue do zod usados para classificar validação local. A
 * classificação é por CÓDIGO, nunca pela mensagem: mensagem é texto de exibição
 * e pode mudar sem quebrar o mapeamento.
 */
const ISSUE_TOO_SMALL = "too_small";
const ISSUE_TOO_BIG = "too_big";

/** Issue de validação local do campo `password` (raiz também conta). */
function isPasswordIssue(issue: Record<string, unknown>): boolean {
  const path = issue.path;
  if (!Array.isArray(path) || path.length === 0) return true;
  return path[0] === "password";
}

/**
 * Resumo de um `ZodError`: quais limites da senha falharam. `null` quando o
 * erro não tem `issues` — distingue "validação local" de "erro do servidor".
 *
 * Issues fora do campo `password` (ex.: confirmação diferente, código `custom`)
 * não são resumidas: quem chama cai na mensagem genérica.
 */
function readValidationIssues(
  error: unknown,
): { tooShort: boolean; tooLong: boolean } | null {
  if (typeof error !== "object" || error === null) return null;

  const issues = (error as { issues?: unknown }).issues;
  if (!Array.isArray(issues)) return null;

  let tooShort = false;
  let tooLong = false;

  for (const issue of issues) {
    if (typeof issue !== "object" || issue === null) continue;

    const record = issue as Record<string, unknown>;
    if (!isPasswordIssue(record)) continue;

    if (record.code === ISSUE_TOO_BIG) tooLong = true;
    else if (record.code === ISSUE_TOO_SMALL) tooShort = true;
  }

  return { tooShort, tooLong };
}

/**
 * Converte o erro da troca de senha obrigatória em texto pt-BR (ADR-09).
 *
 * Função pura: nunca lança e nunca devolve a mensagem do servidor. Classifica
 * só por status/código estável — o corpo da Edge Function é dado não confiável.
 *
 * - 401 (gateway ou função) → sessão expirada;
 * - 409 `password_change_superseded` → sessão expirada: a reserva era de outra
 *   requisição e o token desta ficou defasado;
 * - 409 `password_change_in_progress` → pede para aguardar e repetir;
 * - 400 `password_is_initial` → escolher senha diferente da atual;
 * - 400 `password_too_short` / issue `too_small` → mínimo de 8 code points;
 * - 400 `password_too_long` / issue `too_big` → máximo de 72 bytes;
 * - demais (500, 503, rede, `invalid_body`, 409 sem código, confirmação
 *   diferente) → genérica de falha ao salvar.
 */
export function mapInitialPasswordError(error: unknown): string {
  const status = readErrorStatus(error);
  const code = readErrorCode(error);

  if (status === 401 || code === UNAUTHENTICATED_CODE) {
    return INITIAL_SESSION_EXPIRED_MESSAGE;
  }
  if (code === PASSWORD_CHANGE_SUPERSEDED_CODE) {
    return INITIAL_SESSION_EXPIRED_MESSAGE;
  }
  if (code === PASSWORD_CHANGE_IN_PROGRESS_CODE) {
    return INITIAL_PASSWORD_CHANGE_IN_PROGRESS_MESSAGE;
  }
  if (code === PASSWORD_IS_INITIAL_CODE) {
    return INITIAL_PASSWORD_IS_INITIAL_MESSAGE;
  }
  if (code === PASSWORD_TOO_SHORT_CODE) {
    return INITIAL_PASSWORD_TOO_SHORT_MESSAGE;
  }
  if (code === PASSWORD_TOO_LONG_CODE) {
    return INITIAL_PASSWORD_TOO_LONG_MESSAGE;
  }

  const validationIssues = readValidationIssues(error);
  if (validationIssues !== null) {
    if (validationIssues.tooLong) return INITIAL_PASSWORD_TOO_LONG_MESSAGE;
    if (validationIssues.tooShort) return INITIAL_PASSWORD_TOO_SHORT_MESSAGE;
  }

  return INITIAL_PASSWORD_GENERIC_MESSAGE;
}
