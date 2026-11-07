import { strictEqual } from "node:assert/strict";
import { requestSchema } from "./schemas.ts";

const PAYMENT = "44444444-4444-4444-8444-444444444444";

Deno.test("estorno exige motivo não vazio e no máximo 500", () => {
  strictEqual(requestSchema.safeParse({ payment_id: PAYMENT, reason: "ajuste" }).success, true);
  strictEqual(requestSchema.safeParse({ payment_id: PAYMENT, reason: "   " }).success, false);
  strictEqual(requestSchema.safeParse({ payment_id: PAYMENT, reason: "" }).success, false);
  strictEqual(
    requestSchema.safeParse({ payment_id: PAYMENT, reason: "x".repeat(501) }).success,
    false,
  );
  strictEqual(
    requestSchema.safeParse({ payment_id: PAYMENT, reason: "ok", tenant_id: "t1" }).success,
    false,
  );
});
