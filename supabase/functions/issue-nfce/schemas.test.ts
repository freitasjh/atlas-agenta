import { strictEqual } from "node:assert/strict";
import { requestSchema } from "./schemas.ts";

const ORIGEM = "11111111-1111-4111-8111-111111111111";

Deno.test("issue aceita origem + valor e rejeita tenant_id no corpo", () => {
  strictEqual(
    requestSchema.safeParse({ origem_tipo: "appointment", origem_id: ORIGEM, valor_cents: 4500 }).success,
    true,
  );
  strictEqual(
    requestSchema.safeParse({
      origem_tipo: "appointment",
      origem_id: ORIGEM,
      valor_cents: 4500,
      destinatario_documento: "12345678909",
    }).success,
    true,
  );
  strictEqual(
    requestSchema.safeParse({ origem_tipo: "appointment", origem_id: ORIGEM, valor_cents: 4500, tenant_id: "t1" })
      .success,
    false,
  );
});

Deno.test("issue rejeita origem, valor e documento inválidos", () => {
  strictEqual(
    requestSchema.safeParse({ origem_tipo: "subscription", origem_id: ORIGEM, valor_cents: 4500 }).success,
    false,
  );
  strictEqual(
    requestSchema.safeParse({ origem_tipo: "appointment", origem_id: ORIGEM, valor_cents: 0 }).success,
    false,
  );
  strictEqual(
    requestSchema.safeParse({ origem_tipo: "appointment", origem_id: ORIGEM, valor_cents: 4500, destinatario_documento: "123" })
      .success,
    false,
  );
});
