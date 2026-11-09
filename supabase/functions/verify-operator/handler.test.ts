// Testes da Edge `verify-operator`: 401 sem JWT, 403 sem operador/AAL2, 200 operador+AAL2.
// C5 (enrollment × assurance): `aal` da SESSÃO (JWT) + factor verificado são
// exigidos juntos; token sem `aal2` nega mesmo com factor válido.
// Rodar com: npm run test:functions (deno test --allow-env supabase/functions/verify-operator/).
import { strictEqual as assertEquals } from "node:assert/strict";
import { createVerifyOperatorHandler } from "./handler.ts";
import { readJwtAal } from "../_shared/internal-operator.ts";

function b64url(obj: unknown): string {
  const b64 = btoa(JSON.stringify(obj));
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function jwtWithAal(aal: string | null): string {
  const payload = aal === null ? {} : { aal };
  return `h.${b64url(payload)}.s`;
}

const VALID_AAL2 = jwtWithAal("aal2");
const VALID_AAL1 = jwtWithAal("aal1");
const VALID_NO_AAL = jwtWithAal(null);
const VALID_TOKENS = new Set([VALID_AAL2, VALID_AAL1, VALID_NO_AAL]);

type FakeServiceOptions = {
  userId?: string | null;
  isOperator?: boolean;
  verifiedFactors?: number;
  listError?: boolean;
};

function fakeService(options: FakeServiceOptions): never {
  const { userId = "11111111-1111-1111-1111-111111111111", isOperator = false, verifiedFactors = 0, listError = false } = options;
  const service = {
    auth: {
      getUser: async (token: string) => {
        if (!VALID_TOKENS.has(token)) return { data: { user: null }, error: new Error("invalid") };
        return { data: { user: userId ? { id: userId } : null }, error: null };
      },
      admin: {
        mfa: {
          listFactors: async () => {
            if (listError) return { data: null, error: new Error("db") };
            return {
              data: { totp: verifiedFactors > 0 ? [{ status: "verified" }] : [] },
              error: null,
            };
          },
        },
      },
    },
    from: () => ({
      select: () => ({
        eq: () => ({
          is: () => ({
            maybeSingle: async () => ({ data: isOperator ? { user_id: userId } : null, error: null }),
          }),
        }),
      }),
    }),
  };
  return service as unknown as never;
}

function postRequest(token?: string): Request {
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  return new Request("http://localhost/verify-operator", { method: "POST", headers });
}

Deno.test("verify-operator: sem JWT responde 401 fail-closed", async () => {
  const handler = createVerifyOperatorHandler({ createService: () => fakeService({}) as never });
  const res = await handler(postRequest());
  assertEquals(res.status, 401);
  const body = await res.json() as { is_operator: boolean };
  assertEquals(body.is_operator, false);
});

Deno.test("verify-operator: JWT inválido responde 401", async () => {
  const handler = createVerifyOperatorHandler({ createService: () => fakeService({}) as never });
  const res = await handler(postRequest("bad-jwt"));
  assertEquals(res.status, 401);
});

Deno.test("verify-operator: operador sem factor verificado responde 403 (enrollment)", async () => {
  const handler = createVerifyOperatorHandler({
    createService: () => fakeService({ isOperator: true, verifiedFactors: 0 }) as never,
  });
  const res = await handler(postRequest(VALID_AAL2));
  assertEquals(res.status, 403);
});

Deno.test("verify-operator: sem operador responde 403", async () => {
  const handler = createVerifyOperatorHandler({
    createService: () => fakeService({ isOperator: false, verifiedFactors: 1 }) as never,
  });
  const res = await handler(postRequest(VALID_AAL2));
  assertEquals(res.status, 403);
});

Deno.test("verify-operator: operador+AAL2 responde 200 com prova", async () => {
  const handler = createVerifyOperatorHandler({
    createService: () => fakeService({ isOperator: true, verifiedFactors: 1 }) as never,
  });
  const res = await handler(postRequest(VALID_AAL2));
  assertEquals(res.status, 200);
  const body = await res.json() as { is_operator: boolean; aal: string; user_id: string };
  assertEquals(body.is_operator, true);
  assertEquals(body.aal, "aal2");
});

Deno.test("verify-operator C5: factor válido mas sessão aal1 nega 403 (assurance)", async () => {
  const handler = createVerifyOperatorHandler({
    createService: () => fakeService({ isOperator: true, verifiedFactors: 1 }) as never,
  });
  const res = await handler(postRequest(VALID_AAL1));
  assertEquals(res.status, 403);
  const body = await res.json() as { is_operator: boolean };
  assertEquals(body.is_operator, false);
});

Deno.test("verify-operator C5: token legado sem claim aal nega 403", async () => {
  const handler = createVerifyOperatorHandler({
    createService: () => fakeService({ isOperator: true, verifiedFactors: 1 }) as never,
  });
  const res = await handler(postRequest(VALID_NO_AAL));
  assertEquals(res.status, 403);
});

Deno.test("readJwtAal: extrai aal, null sem claim ou token malformado", () => {
  assertEquals(readJwtAal(VALID_AAL2), "aal2");
  assertEquals(readJwtAal(VALID_AAL1), "aal1");
  assertEquals(readJwtAal(VALID_NO_AAL), null);
  assertEquals(readJwtAal("valid-jwt"), null);
  assertEquals(readJwtAal(""), null);
});
