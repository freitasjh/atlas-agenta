import { strictEqual } from "node:assert/strict";
import { payloadSchema } from "./schemas.ts";

Deno.test("exige id, event e payment.id quando payment existe", () => {
  strictEqual(payloadSchema.safeParse({}).success, false);
  strictEqual(payloadSchema.safeParse({ event: "X" }).success, false);
  strictEqual(payloadSchema.safeParse({ id: "e", event: "X", payment: {} }).success, false);
  strictEqual(
    payloadSchema.safeParse({ id: "e", event: "X", payment: { id: "" } }).success,
    false,
  );
});

Deno.test("aceita payload do Asaas com campos extras em todos os níveis", () => {
  const parsed = payloadSchema.safeParse({
    id: "e",
    event: "X",
    payment: { id: "p", value: 10, extra: true },
    extra: 1,
  });
  strictEqual(parsed.success, true);
  if (parsed.success) {
    strictEqual(parsed.data.id, "e");
    strictEqual(parsed.data.event, "X");
    strictEqual(parsed.data.payment?.id, "p");
  }
});

Deno.test("aceita payment ausente (no-op decidido no handler)", () => {
  strictEqual(payloadSchema.safeParse({ id: "e", event: "X" }).success, true);
});

Deno.test("payment.value como string não derruba o parse", () => {
  const parsed = payloadSchema.safeParse({
    id: "e",
    event: "X",
    payment: { id: "p", value: "30.50", paymentDate: 123 },
  });
  strictEqual(parsed.success, true);
});
