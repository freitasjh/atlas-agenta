// Guarda de consulta por id opcional.
//
// `supabase-js` serializa `.eq("id", null)` como `id=eq.null`; o PostgREST
// responde 400 `22P02` (uuid inválido) e o chamador converte em 500 INTERNAL.
// Quando o id é opcional (walk-in anônimo, venda por combo), a query só pode
// ser construída se o id existir.

export interface OptionalQueryResult<T> {
  data: T | null;
  error: unknown;
}

/**
 * Executa a query somente quando `id` é um uuid presente; id nulo/ausente
 * devolve o mesmo shape de "nenhuma linha" sem tocar no PostgREST.
 *
 * `query` devolve `PromiseLike`, não `Promise`: o `PostgrestBuilder` do
 * supabase-js é thenable (tem `.then`) mas não implementa `catch`/`finally`.
 * Devolvemos sempre uma `Promise` real para o chamador poder usar `await`.
 */
export async function queryOptionalById<T>(
  id: string | null | undefined,
  query: () => PromiseLike<OptionalQueryResult<T>>,
): Promise<OptionalQueryResult<T>> {
  if (id === null || id === undefined) return { data: null, error: null };
  return Promise.resolve().then(() => query());
}
