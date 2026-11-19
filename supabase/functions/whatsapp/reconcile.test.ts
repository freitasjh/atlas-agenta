// Testes de `decideCheckWrite` (débito P2 whatsapp-check-404) — decisão pura do
// `handleCheck`, sem rede/banco. Rodar com:
// deno test --allow-env supabase/functions/whatsapp/
import { strict as assert } from "node:assert/strict";
import { EvolutionInstanceNotFoundError } from "./evolution-adapter.ts";
import { decideCheckWrite } from "./reconcile.ts";

Deno.test("check: open → escreve conectado", () => {
  assert.equal(decideCheckWrite({ state: "open" }, null), "conectado");
});

Deno.test("check: 404 tipado → escreve desconectado (instância apagada no provedor)", () => {
  assert.equal(
    decideCheckWrite(null, new EvolutionInstanceNotFoundError()),
    "desconectado",
  );
});

Deno.test("check: 404 tipado vence open concomitante (reconciliação defensiva)", () => {
  assert.equal(
    decideCheckWrite({ state: "open" }, new EvolutionInstanceNotFoundError()),
    "desconectado",
  );
});

Deno.test("check: connecting/close sem erro → sem escrita (best-effort)", () => {
  assert.equal(decideCheckWrite({ state: "connecting" }, null), null);
  assert.equal(decideCheckWrite({ state: "close" }, null), null);
});

Deno.test("check: erro genérico sem 404 → sem escrita (best-effort, mantém linha)", () => {
  assert.equal(decideCheckWrite(null, new Error("timeout")), null);
  assert.equal(decideCheckWrite({ state: "close" }, new Error("timeout")), null);
});

Deno.test("check: sem estado e sem erro → sem escrita", () => {
  assert.equal(decideCheckWrite(null, null), null);
});
