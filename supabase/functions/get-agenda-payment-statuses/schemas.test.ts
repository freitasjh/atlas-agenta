import { strictEqual } from "node:assert/strict";
import { requestSchema } from "./schemas.ts";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

Deno.test("statuses aceita 1..200 uuids", () => {
  strictEqual(requestSchema.safeParse({ appointment_ids: [A, B] }).success, true);
  strictEqual(requestSchema.safeParse({ appointment_ids: [A] }).success, true);
  strictEqual(requestSchema.safeParse({ appointment_ids: [] }).success, false);
  strictEqual(requestSchema.safeParse({ appointment_ids: ["x"] }).success, false);
});

Deno.test("statuses recusa lote acima de 200", () => {
  const ids = Array.from({ length: 201 }, () => A);
  strictEqual(requestSchema.safeParse({ appointment_ids: ids }).success, false);
  strictEqual(requestSchema.safeParse({ appointment_ids: ids.slice(0, 200) }).success, true);
});

Deno.test("statuses rejeita tenant_id/role e campos desconhecidos", () => {
  strictEqual(
    requestSchema.safeParse({ appointment_ids: [A], tenant_id: "t1" }).success,
    false,
  );
  strictEqual(requestSchema.safeParse({ appointment_ids: [A], role: "admin" }).success, false);
  strictEqual(requestSchema.safeParse({ appointment_ids: [A], extra: true }).success, false);
});
