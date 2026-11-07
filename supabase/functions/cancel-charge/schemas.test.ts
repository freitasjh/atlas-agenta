import { strictEqual } from "node:assert/strict";
import { requestSchema } from "./schemas.ts";

const CHARGE = "33333333-3333-4333-8333-333333333333";

Deno.test("cancel aceita force opcional e rejeita chaves extras", () => {
  strictEqual(requestSchema.safeParse({ charge_id: CHARGE }).success, true);
  strictEqual(requestSchema.safeParse({ charge_id: CHARGE, force: true }).success, true);
  strictEqual(
    requestSchema.safeParse({ charge_id: CHARGE, tenant_id: "t1" }).success,
    false,
  );
});
