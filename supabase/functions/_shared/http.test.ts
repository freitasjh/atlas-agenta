// Testes do contrato de erro da Edge (`mapRpcError`): SQLSTATE de negócio vira
// HTTP + código estável; 23P01 (exclusion_violation da agenda) NUNCA vira 500.
// Rodar com: deno test --allow-env supabase/functions/_shared/
import { deepStrictEqual, strictEqual } from "node:assert/strict";
import { errorResponse, mapRpcError, messageForCode } from "./http.ts";

Deno.test("PT4xx com message=CODE vira HTTP + código de domínio", () => {
  const mapped = mapRpcError({ code: "PT409", message: "IDEMPOTENCY_CONFLICT" });
  strictEqual(mapped.status, 409);
  strictEqual(mapped.code, "IDEMPOTENCY_CONFLICT");
});

Deno.test("23P01 (exclusion_violation) vira 409 SLOT_CONFLICT, não INTERNAL", () => {
  const mapped = mapRpcError({
    code: "23P01",
    message:
      'conflicting key value violates exclusion constraint "appointments_no_overlap"',
  });
  strictEqual(mapped.status, 409);
  strictEqual(mapped.code, "SLOT_CONFLICT");
  strictEqual(
    messageForCode(mapped.code),
    "Profissional ocupado neste horário. Escolha outro profissional ou outro horário.",
  );
});

Deno.test("23P01 não vaza detalhe de SQL na resposta HTTP", async () => {
  const mapped = mapRpcError({
    code: "23P01",
    message: 'conflicting key value violates exclusion constraint "appointments_no_overlap"',
  });
  const response = errorResponse(mapped);
  strictEqual(response.status, 409);
  const body = await response.json();
  deepStrictEqual(body, {
    code: "SLOT_CONFLICT",
    message: "Profissional ocupado neste horário. Escolha outro profissional ou outro horário.",
  });
});

Deno.test("código desconhecido vira 500 INTERNAL", () => {
  const mapped = mapRpcError({ code: "22P02", message: "invalid input syntax" });
  strictEqual(mapped.status, 500);
  strictEqual(mapped.code, "INTERNAL");
});

Deno.test("erro nulo vira 500 INTERNAL", () => {
  const mapped = mapRpcError(null);
  strictEqual(mapped.status, 500);
  strictEqual(mapped.code, "INTERNAL");
});
