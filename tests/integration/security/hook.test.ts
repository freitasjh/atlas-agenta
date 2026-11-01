// Hook `custom_access_token` (ADR-01) contra o stack local: RQ-05 e RQ-06 da ADR-13.
// O hook é chamado pelo GoTrue a cada emissão de token; os casos também exercitam a função
// diretamente, com assinatura Standard Webhooks, para cobrir 401 sem assinatura e o 500 de falha
// de leitura simulada.
import { createHmac, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "../helpers/sql.ts";
import { decodeAccessToken } from "../helpers/jwt.ts";
import { readFunctionsEnv } from "../helpers/env.ts";
import { callFunction } from "../helpers/functions.ts";
import { ensureFunctionsDefault } from "../helpers/functions-server.ts";
import {
  createAuthUserWithoutProfileSession,
  createCommonUser,
  deleteTestUsers,
  tenantIdOf,
  type TestUser,
} from "../helpers/users.ts";

interface SignedHeaders extends Record<string, string> {
  "webhook-id": string;
  "webhook-timestamp": string;
  "webhook-signature": string;
}

function hookSecret(): string {
  const secret = readFunctionsEnv().CUSTOM_ACCESS_TOKEN_HOOK_SECRET;
  if (!secret) throw new Error("CUSTOM_ACCESS_TOKEN_HOOK_SECRET ausente no env das funções.");
  return secret;
}

function signBody(rawBody: string): SignedHeaders {
  const messageId = randomUUID();
  const timestamp = String(Math.floor(Date.now() / 1000));
  const encodedKey = hookSecret().trim().replace(/^v1,/, "").replace(/^whsec_/, "");
  const signature = createHmac("sha256", Buffer.from(encodedKey, "base64"))
    .update(`${messageId}.${timestamp}.${rawBody}`)
    .digest("base64");
  return {
    "webhook-id": messageId,
    "webhook-timestamp": timestamp,
    "webhook-signature": `v1,${signature}`,
  };
}

function hookBody(userId: string, mustChangePassword = false): string {
  return JSON.stringify({
    user_id: userId,
    claims: {
      sub: userId,
      role: "authenticated",
      app_metadata: {
        provider: "email",
        providers: ["email"],
        must_change_password: mustChangePassword,
      },
    },
    authentication_method: "password",
  });
}

let user: TestUser;

beforeAll(async () => {
  await ensureFunctionsDefault();
  user = await createCommonUser("hook");
});

afterAll(async () => {
  await deleteTestUsers();
});

describe("RQ-05 e RQ-06 claims do access token pelo hook", () => {
  it("token de admin de empresa tem role authenticated, user_role, tenant_id e flag", async () => {
    const tenantId = await tenantIdOf(user.id);
    const claims = decodeAccessToken(user.accessToken);

    expect(claims.role).toBe("authenticated");
    expect(claims.user_role).toBe("admin");
    expect(claims.tenant_id).toBe(tenantId);
    expect(claims.must_change_password).toBe(false);
  });

  it("chamada assinada devolve claims com o papel do profile e preserva role", async () => {
    const tenantId = await tenantIdOf(user.id);
    const rawBody = hookBody(user.id);
    const response = await callFunction("custom-access-token", {
      rawBody,
      headers: signBody(rawBody),
    });

    expect(response.status, response.text).toBe(200);
    const claims = response.json?.claims as Record<string, unknown> | undefined;
    expect(claims?.role).toBe("authenticated");
    expect(claims?.user_role).toBe("admin");
    expect(claims?.tenant_id).toBe(tenantId);
    expect(claims?.must_change_password).toBe(false);
  });

  it("sem assinatura responde 401", async () => {
    const response = await callFunction("custom-access-token", {
      rawBody: hookBody(user.id),
    });

    expect(response.status).toBe(401);
    expect(response.json?.code).toBe("unauthorized");
  });

  it("falha de leitura do profile responde 500 identity_unavailable", async () => {
    // Simula indisponibilidade do PostgREST revogando o SELECT da service role por um instante.
    sql("revoke select on public.profiles from service_role;");
    try {
      const rawBody = hookBody(user.id);
      const response = await callFunction("custom-access-token", {
        rawBody,
        headers: signBody(rawBody),
      });

      expect(response.status).toBe(500);
      expect(response.json?.code).toBe("identity_unavailable");
    } finally {
      sql("grant select on public.profiles to service_role;");
    }
  });
});

describe("RQ-06 usuário sem profile", () => {
  it("login conclui e o token não traz user_role nem tenant_id", async () => {
    const orphan = await createAuthUserWithoutProfileSession("hook-orphan");
    const claims = decodeAccessToken(orphan.accessToken);

    expect(claims.role).toBe("authenticated");
    expect(claims.user_role).toBeNull();
    expect(claims.tenant_id).toBeNull();
    expect(claims.must_change_password).toBe(false);
  });
});
