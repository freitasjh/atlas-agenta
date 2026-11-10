// Testes de `queryOptionalById`: id ausente não constrói a query (evita
// `id=eq.null` → 400 22P02 no PostgREST); id presente repassa o resultado.
// Rodar com: deno test --allow-env supabase/functions/_shared/
import { deepStrictEqual, rejects, strictEqual } from "node:assert/strict";
import { queryOptionalById } from "./nullable.ts";

function countingQuery<T>(result: { data: T | null; error: unknown }) {
  let calls = 0;
  const query = () => {
    calls += 1;
    return Promise.resolve(result);
  };
  return { query, calls: () => calls };
}

Deno.test("id null: zero chamadas e shape vazio", async () => {
  const { query, calls } = countingQuery({ data: { id: "x" }, error: null });
  const out = await queryOptionalById(null, query);
  strictEqual(calls(), 0);
  deepStrictEqual(out, { data: null, error: null });
});

Deno.test("id undefined: zero chamadas e shape vazio", async () => {
  const { query, calls } = countingQuery({ data: { id: "x" }, error: null });
  const out = await queryOptionalById(undefined, query);
  strictEqual(calls(), 0);
  deepStrictEqual(out, { data: null, error: null });
});

Deno.test("id presente: chama a query e devolve o resultado", async () => {
  const expected = { data: { id: "abc" }, error: null };
  const { query, calls } = countingQuery(expected);
  const out = await queryOptionalById("abc", query);
  strictEqual(calls(), 1);
  deepStrictEqual(out, expected);
});

Deno.test("rejeição da query propaga", async () => {
  const boom = new Error("boom");
  await rejects(
    queryOptionalById("abc", () => Promise.reject(boom)),
    (err) => err === boom,
  );
});

Deno.test("retorno é sempre uma Promise real", () => {
  strictEqual(
    queryOptionalById(null, () => Promise.resolve({ data: null, error: null })) instanceof Promise,
    true,
  );
  strictEqual(
    queryOptionalById("abc", () => Promise.resolve({ data: null, error: null })) instanceof Promise,
    true,
  );
});
