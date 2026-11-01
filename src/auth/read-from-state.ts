/**
 * Normaliza `state.from` para `pathname + search` (ADR-08). Os guards gravam
 * string desde a ADR-11; o formato antigo (objeto `Location`) continua aceito
 * para estados de navegação legados. Qualquer formato desconhecido vira
 * `undefined` — o destino cai na regra do papel.
 */
export function readFromState(state: unknown): string | undefined {
  if (state === null || typeof state !== "object") return undefined;

  const from = (state as { from?: unknown }).from;
  if (typeof from === "string") return from;
  if (from === null || typeof from !== "object") return undefined;

  const { pathname, search } = from as {
    pathname?: unknown;
    search?: unknown;
  };
  if (typeof pathname !== "string") return undefined;

  return `${pathname}${typeof search === "string" ? search : ""}`;
}

/** Limite de tamanho do aviso de navegação (texto curto de feedback). */
const MAX_NOTICE_LENGTH = 280;

/**
 * Normaliza `state.notice` — aviso curto entregue pela tela que navegou
 * (ADR-03: cadastro sem sessão → `/login`). `state` é entrada não confiável:
 * só string não vazia e curta vira texto; o resto é `null`. O retorno é sempre
 * renderizado como texto (React escapa), nunca como HTML.
 */
export function readNoticeState(state: unknown): string | null {
  if (state === null || typeof state !== "object") return null;

  const notice = (state as { notice?: unknown }).notice;
  if (typeof notice !== "string") return null;

  const trimmed = notice.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_NOTICE_LENGTH) return null;

  return trimmed;
}
