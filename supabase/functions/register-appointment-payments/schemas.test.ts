import { strictEqual } from "node:assert/strict";
import { requestSchema, schemaErrorCode } from "./schemas.ts";

const KEY = "22222222-2222-4222-8222-222222222222";
const APPOINTMENT = "11111111-1111-4111-8111-111111111111";

function codeFor(body: unknown): string {
  const parsed = requestSchema.safeParse(body);
  return parsed.success ? "OK" : schemaErrorCode(parsed.error);
}

Deno.test("schema aceita lote válido com tip_cents opcional", () => {
  const parsed = requestSchema.safeParse({
    appointment_id: APPOINTMENT,
    idempotency_key: KEY,
    close_appointment: true,
    payments: [
      { method: "dinheiro", amount_cents: 6000 },
      { method: "pix_sistema", amount_cents: 4000, tip_cents: 0 },
    ],
  });
  strictEqual(parsed.success, true);
});

Deno.test("schema rejeita tenant_id/role e campos desconhecidos", () => {
  strictEqual(
    codeFor({
      appointment_id: APPOINTMENT,
      idempotency_key: KEY,
      payments: [],
      tenant_id: "t1",
    }),
    "INVALID_BODY",
  );
  strictEqual(
    codeFor({
      appointment_id: APPOINTMENT,
      idempotency_key: KEY,
      payments: [],
      role: "admin",
    }),
    "INVALID_BODY",
  );
});

Deno.test("schema distingue método e valor inválidos", () => {
  strictEqual(
    codeFor({
      appointment_id: APPOINTMENT,
      idempotency_key: KEY,
      payments: [{ method: "boleto", amount_cents: 100 }],
    }),
    "INVALID_METHOD",
  );
  strictEqual(
    codeFor({
      appointment_id: APPOINTMENT,
      idempotency_key: KEY,
      payments: [{ method: "dinheiro", amount_cents: 0 }],
    }),
    "INVALID_AMOUNT",
  );
  strictEqual(
    codeFor({
      appointment_id: APPOINTMENT,
      idempotency_key: KEY,
      payments: [{ method: "dinheiro", amount_cents: 100, tip_cents: -1 }],
    }),
    "INVALID_AMOUNT",
  );
});

Deno.test("schema limita o lote a 10 itens e exige uuid", () => {
  const eleven = Array.from({ length: 11 }, () => ({ method: "dinheiro", amount_cents: 100 }));
  strictEqual(
    codeFor({ appointment_id: APPOINTMENT, idempotency_key: KEY, payments: eleven }),
    "INVALID_AMOUNT",
  );
  strictEqual(
    codeFor({ appointment_id: "nao-uuid", idempotency_key: KEY, payments: [] }),
    "INVALID_BODY",
  );
});
