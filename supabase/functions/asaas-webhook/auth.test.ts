import { strictEqual } from "node:assert/strict";
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { isAuthorized, resolveExpectedToken } from "./auth.ts";

const GLOBAL_TOKEN = "global-token";

const env = {
  get(name: string): string | undefined {
    return name === "ASAAS_WEBHOOK_TOKEN" ? GLOBAL_TOKEN : undefined;
  },
};

function serviceWithTenantToken(token: string | null, error: { code: string; message: string } | null = null) {
  return {
    from(table: string) {
      if (table !== "tenant_asaas_config") throw new Error(`tabela inesperada: ${table}`);
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: token === null ? null : { asaas_webhook_token: token },
              error,
            }),
          }),
        }),
      };
    },
  } as unknown as SupabaseClient;
}

Deno.test("cobrança com token de tenant: só o token do tenant autoriza", async () => {
  const service = serviceWithTenantToken("tenant-token");
  const expected = await resolveExpectedToken(service, { tenant_id: "t1" }, env);
  strictEqual(expected, "tenant-token");
  strictEqual(isAuthorized("tenant-token", expected), true);
  strictEqual(isAuthorized(GLOBAL_TOKEN, expected), false);
});

Deno.test("cobrança com token de tenant vazio usa o global", async () => {
  const expected = await resolveExpectedToken(serviceWithTenantToken(""), { tenant_id: "t1" }, env);
  strictEqual(expected, GLOBAL_TOKEN);
  strictEqual(isAuthorized(GLOBAL_TOKEN, expected), true);
});

Deno.test("cobrança desconhecida usa apenas o global", async () => {
  const expected = await resolveExpectedToken(serviceWithTenantToken("tenant-token"), null, env);
  strictEqual(expected, GLOBAL_TOKEN);
  strictEqual(isAuthorized(GLOBAL_TOKEN, expected), true);
  strictEqual(isAuthorized("tenant-token", expected), false);
});

Deno.test("sem token configurado é fail-closed", async () => {
  const emptyEnv = { get: () => undefined };
  const expected = await resolveExpectedToken(serviceWithTenantToken(""), { tenant_id: "t1" }, emptyEnv);
  strictEqual(expected, null);
  strictEqual(isAuthorized("qualquer", expected), false);
  strictEqual(isAuthorized("", GLOBAL_TOKEN), false);
});
