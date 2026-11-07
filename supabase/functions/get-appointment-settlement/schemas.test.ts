import { strictEqual } from "node:assert/strict";
import { requestSchema } from "./schemas.ts";

const APPOINTMENT = "11111111-1111-4111-8111-111111111111";

Deno.test("settlement exige appointment_id uuid", () => {
  strictEqual(requestSchema.safeParse({ appointment_id: APPOINTMENT }).success, true);
  strictEqual(requestSchema.safeParse({ appointment_id: "x" }).success, false);
});

Deno.test("settlement rejeita tenant_id/campos desconhecidos", () => {
  strictEqual(
    requestSchema.safeParse({ appointment_id: APPOINTMENT, tenant_id: "t1" }).success,
    false,
  );
});
