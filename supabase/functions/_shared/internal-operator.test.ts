// Testes de `readVerifiedFactorsCount`: shape real do supabase-js é
// { data: { factors: [...] } }; array puro e objeto
// ({ all | totp | phone }) mantidos por compat legada.
// Outro formato → 0 (fail-closed). Sem PII em log.
// Rodar com: deno test --allow-env supabase/functions/_shared/
import { strictEqual } from "node:assert/strict";
import { ApiError } from "./http.ts";
import { readVerifiedFactorsCount } from "./internal-operator.ts";

type ListResult = { data: unknown; error: unknown };

function fakeService(data: unknown, error: unknown = null): never {
  const service = {
    auth: {
      admin: {
        mfa: {
          listFactors: async () => ({ data, error }) as ListResult,
        },
      },
    },
  };
  return service as unknown as never;
}

const UID = "11111111-1111-1111-1111-111111111111";

Deno.test("factors array real: conta status verified (totp)", async () => {
  const service = fakeService([
    { status: "verified", factor_type: "totp", id: "f-1" },
  ]);
  strictEqual(await readVerifiedFactorsCount(service, UID), 1);
});

Deno.test("factors array real: ignora unverified, conta só verified", async () => {
  const service = fakeService([
    { status: "verified", factor_type: "totp", id: "f-1" },
    { status: "unverified", factor_type: "totp", id: "f-2" },
    { status: "verified", factor_type: "phone", id: "f-3" },
  ]);
  strictEqual(await readVerifiedFactorsCount(service, UID), 2);
});

Deno.test("factors array real vazio retorna 0 (fail-closed)", async () => {
  const service = fakeService([]);
  strictEqual(await readVerifiedFactorsCount(service, UID), 0);
});

Deno.test("factors objeto legado { totp } mantido por compat", async () => {
  const service = fakeService({ totp: [{ status: "verified" }] });
  strictEqual(await readVerifiedFactorsCount(service, UID), 1);
});

Deno.test("factors shape real supabase-js { factors: [...] } conta verified", async () => {
  const service = fakeService({
    factors: [{ status: "verified", factor_type: "totp" }],
  });
  strictEqual(await readVerifiedFactorsCount(service, UID), 1);
});

Deno.test("factors formato desconhecido retorna 0 (fail-closed)", async () => {
  const service = fakeService({ outro: "formato" });
  strictEqual(await readVerifiedFactorsCount(service, UID), 0);
});

Deno.test("factors null retorna 0 (fail-closed)", async () => {
  const service = fakeService(null);
  strictEqual(await readVerifiedFactorsCount(service, UID), 0);
});

Deno.test("erro do listFactors falha fechado (500 INTERNAL)", async () => {
  const service = fakeService(null, new Error("db"));
  let thrown: unknown = null;
  try {
    await readVerifiedFactorsCount(service, UID);
  } catch (err) {
    thrown = err;
  }
  strictEqual(thrown instanceof ApiError, true);
  strictEqual((thrown as ApiError).status, 500);
});
