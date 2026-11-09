import { describe, expect, it, vi } from "vitest";

import { queryOptionalById } from "../../supabase/functions/_shared/nullable.ts";

/**
 * Guarda de consulta por id opcional (bug pdv-checkout-anonimo): `.eq("id", null)`
 * vira `id=eq.null` no PostgREST (400 22P02 → 500 INTERNAL). O helper precisa
 * pular a query quando o id é nulo/ausente e devolver o shape de "nenhuma linha".
 */
describe("queryOptionalById", () => {
  it("não executa a query quando o id é null e devolve data null", async () => {
    const query = vi.fn(async () => ({ data: { name: "x" }, error: null }));
    const result = await queryOptionalById(null, query);
    expect(query).not.toHaveBeenCalled();
    expect(result).toEqual({ data: null, error: null });
  });

  it("não executa a query quando o id é undefined", async () => {
    const query = vi.fn(async () => ({ data: { name: "x" }, error: null }));
    const result = await queryOptionalById(undefined, query);
    expect(query).not.toHaveBeenCalled();
    expect(result).toEqual({ data: null, error: null });
  });

  it("executa a query e devolve o resultado quando o id existe", async () => {
    const query = vi.fn(async () => ({ data: { name: "Cliente" }, error: null }));
    const result = await queryOptionalById("11111111-1111-4111-8111-111111111111", query);
    expect(query).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ data: { name: "Cliente" }, error: null });
  });
});
