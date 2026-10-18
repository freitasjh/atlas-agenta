/**
 * Mapa de erros do Postgres/PostgREST → mensagens pt-BR amigáveis para o
 * agendamento (customers/appointments). Entrada é dado não confiável (resposta
 * de API): lê `code`/`message` **defensivamente**, nunca vaza detalhe de schema
 * e nunca loga PII do cliente.
 *
 * Códigos relevantes (espelham as travas do banco, ADR-02/03/04):
 *   23P01 exclusion_violation  -> conflito de horário do profissional
 *   check_violation            -> transição de estado inválida (trigger)
 *   23503 foreign_key_violation / violação de RLS -> sem permissão
 */

/** Lê `error.code` de um PostgrestError sem assumir o shape. */
function readCode(error: unknown): string | undefined {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = (error as { code: unknown }).code;
    return typeof code === "string" ? code : undefined;
  }
  return undefined;
}

/** Lê `error.message` defensivamente (para distinguir o `check_violation`). */
function readMessage(error: unknown): string {
  if (typeof error === "object" && error !== null && "message" in error) {
    const message = (error as { message: unknown }).message;
    return typeof message === "string" ? message : "";
  }
  return "";
}

const CONFLICT_MESSAGE =
  "Este profissional já tem um agendamento neste horário.";
const INVALID_TRANSITION_MESSAGE =
  "Não é possível mudar para este status.";
const NO_PERMISSION_MESSAGE = "Sem permissão para esta ação.";
const GENERIC_MESSAGE = "Não foi possível salvar. Tente novamente.";

/**
 * Converte um erro de operação de agendamento em mensagem pt-BR para o usuário.
 * Fallback seguro quando o código é desconhecido.
 */
export function mapSchedulingError(error: unknown): string {
  const code = readCode(error);

  // Conflito de horário (constraint de exclusão) — corrida que escapou da
  // checagem local cai aqui, na mesma mensagem da checagem na app.
  if (code === "23P01") return CONFLICT_MESSAGE;

  // Transição de estado recusada pelo trigger (`raise ... errcode
  // 'check_violation'`). A UI já não deveria oferecer — defesa dupla.
  if (code === "23514" || code === "check_violation") {
    return INVALID_TRANSITION_MESSAGE;
  }

  // FK composta por tenant / violação de RLS: normalmente bug de UI oferecendo
  // id de outro tenant, que o banco corretamente barra. Não vaza schema.
  if (code === "23503" || code === "42501") return NO_PERMISSION_MESSAGE;

  // PostgREST devolve RLS negada como "permission denied"/sem linha; fallback
  // extra por mensagem quando o code não veio.
  if (/permission denied|row-level security/i.test(readMessage(error))) {
    return NO_PERMISSION_MESSAGE;
  }

  return GENERIC_MESSAGE;
}
