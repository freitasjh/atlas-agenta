import { strictEqual } from "node:assert/strict";
import { centsFromGatewayValue, parseGatewayDate } from "../_shared/asaas.ts";
import { classifyAsaasEvent } from "./events.ts";

Deno.test("classifica liquidação (case-insensitive)", () => {
  strictEqual(classifyAsaasEvent("PAYMENT_RECEIVED"), "settle");
  strictEqual(classifyAsaasEvent("PAYMENT_CONFIRMED"), "settle");
  strictEqual(classifyAsaasEvent("payment_confirmed"), "settle");
});

Deno.test("classifica overdue e deleted", () => {
  strictEqual(classifyAsaasEvent("PAYMENT_OVERDUE"), "overdue");
  strictEqual(classifyAsaasEvent("PAYMENT_DELETED"), "deleted");
});

Deno.test("refund/chargeback vencem qualquer prefixo PAYMENT_", () => {
  strictEqual(classifyAsaasEvent("PAYMENT_PARTIALLY_REFUNDED"), "refund");
  strictEqual(classifyAsaasEvent("PAYMENT_CHARGEBACK_REQUESTED"), "refund");
  strictEqual(classifyAsaasEvent("x_refund_y"), "refund");
  strictEqual(classifyAsaasEvent("payments_chargeback_dispute"), "refund");
});

Deno.test("eventos desconhecidos e vazios são ignorados", () => {
  strictEqual(classifyAsaasEvent("PAYMENT_CREATED"), "ignore");
  strictEqual(classifyAsaasEvent(""), "ignore");
  strictEqual(classifyAsaasEvent("   "), "ignore");
});

Deno.test("converte valor do gateway em centavos", () => {
  strictEqual(centsFromGatewayValue(30.5), 3050);
  strictEqual(centsFromGatewayValue("30.50"), 3050);
  strictEqual(centsFromGatewayValue("30,50"), 3050);
  strictEqual(centsFromGatewayValue(0), 0);
  strictEqual(centsFromGatewayValue(null), null);
  strictEqual(centsFromGatewayValue(undefined), null);
  strictEqual(centsFromGatewayValue("abc"), null);
  strictEqual(centsFromGatewayValue(Number.NaN), null);
  strictEqual(centsFromGatewayValue({}), null);
});

Deno.test("parseia datas do gateway em ISO-8601 UTC", () => {
  strictEqual(parseGatewayDate("2026-11-06"), "2026-11-06T00:00:00.000Z");
  strictEqual(parseGatewayDate("2026-11-06T12:34:56.000Z"), "2026-11-06T12:34:56.000Z");
  strictEqual(parseGatewayDate("2026-13-45"), null);
  strictEqual(parseGatewayDate(""), null);
  strictEqual(parseGatewayDate(null), null);
  strictEqual(parseGatewayDate(123), null);
});
