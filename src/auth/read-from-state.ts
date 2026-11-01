/**
 * Normaliza `state.from` para `pathname + search` (ADR-08). Os guards ainda
 * gravam o objeto `Location`; a decisão de destino consome string. Qualquer
 * formato desconhecido vira `undefined` — o destino cai na regra do papel.
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
