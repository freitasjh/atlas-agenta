import { deepStrictEqual, strictEqual } from "node:assert/strict";
import { logEvent } from "../_shared/http.ts";

function capture(run: () => void): string {
  const original = console.log;
  const lines: string[] = [];
  console.log = (...args: unknown[]) => {
    lines.push(args.map((arg) => String(arg)).join(" "));
  };
  try {
    run();
  } finally {
    console.log = original;
  }
  strictEqual(lines.length, 1);
  return lines[0] ?? "";
}

Deno.test("event_id e event_type entram no log técnico", () => {
  const line = capture(() =>
    logEvent("asaas_webhook", { event_id: "e", event_type: "PAYMENT_RECEIVED" }),
  );
  deepStrictEqual(JSON.parse(line), {
    event: "asaas_webhook",
    event_id: "e",
    event_type: "PAYMENT_RECEIVED",
  });
});

Deno.test("campos fora da whitelist são descartados", () => {
  const line = capture(() =>
    logEvent("asaas_webhook", {
      event_id: "e",
      qr: "000201",
      payload: "{}",
      token: "segredo",
      name: "Fulano",
    } as never),
  );
  strictEqual(line.includes("qr"), false);
  strictEqual(line.includes("000201"), false);
  strictEqual(line.includes("payload"), false);
  strictEqual(line.includes("segredo"), false);
  strictEqual(line.includes("Fulano"), false);
  deepStrictEqual(JSON.parse(line), { event: "asaas_webhook", event_id: "e" });
});

Deno.test("valor nulo é omitido do log", () => {
  const line = capture(() => logEvent("asaas_webhook", { event_id: null }));
  deepStrictEqual(JSON.parse(line), { event: "asaas_webhook" });
});
