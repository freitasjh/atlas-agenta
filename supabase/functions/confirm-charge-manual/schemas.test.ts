import { strictEqual } from "node:assert/strict";
import { requestSchema } from "./schemas.ts";

const CHARGE = "33333333-3333-4333-8333-333333333333";

Deno.test("confirmação manual aceita paid_at ISO e rejeita data inválida", () => {
  strictEqual(requestSchema.safeParse({ charge_id: CHARGE }).success, true);
  strictEqual(
    requestSchema.safeParse({ charge_id: CHARGE, paid_at: "2026-11-06T18:00:00Z" }).success,
    true,
  );
  strictEqual(
    requestSchema.safeParse({ charge_id: CHARGE, paid_at: "ontem" }).success,
    false,
  );
  strictEqual(
    requestSchema.safeParse({ charge_id: CHARGE, tenant_id: "t1" }).success,
    false,
  );
});
