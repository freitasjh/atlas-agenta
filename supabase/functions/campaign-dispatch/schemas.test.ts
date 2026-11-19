import { strictEqual } from "node:assert/strict";
import { requestSchema } from "./schemas.ts";

Deno.test("schemas — campaign_id uuid obrigatório; limit com default e teto", () => {
  const ok = requestSchema.safeParse({ campaign_id: "123e4567-e89b-12d3-a456-426614174000" });
  strictEqual(ok.success, true);
  if (ok.success) strictEqual(ok.data.limit, 50);

  strictEqual(requestSchema.safeParse({}).success, false);
  strictEqual(requestSchema.safeParse({ campaign_id: "x" }).success, false);
  strictEqual(
    requestSchema.safeParse({ campaign_id: "123e4567-e89b-12d3-a456-426614174000", limit: 0 }).success,
    false,
  );
  strictEqual(
    requestSchema.safeParse({ campaign_id: "123e4567-e89b-12d3-a456-426614174000", limit: 201 }).success,
    false,
  );
  strictEqual(
    requestSchema.safeParse({
      campaign_id: "123e4567-e89b-12d3-a456-426614174000",
      extra: 1,
    }).success,
    false,
  );
});
