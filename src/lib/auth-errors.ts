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
  return (
    error instanceof TypeError &&
    /fetch|network/i.test(error.message)
  );
}
