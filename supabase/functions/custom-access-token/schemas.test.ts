// Testes de schema e montagem de claims do hook `custom_access_token` (ADR-01). Rodar com:
//   deno test supabase/functions/custom-access-token/schemas.test.ts
import { deepStrictEqual as assertEquals } from "node:assert/strict";
import {
  buildHookClaims,
  hookInputSchema,
  profileRowSchema,
} from "./schemas.ts";

const USER_ID = "7f1c2a3e-8b4d-4e5f-9a6b-1c2d3e4f5a6b";
const TENANT_ID = "2b3c4d5e-6f70-4a8b-9c0d-1e2f3a4b5c6d";

Deno.test("aceita entrada válida do hook", () => {
  const parsed = hookInputSchema.safeParse({
    user_id: USER_ID,
    claims: { sub: USER_ID, role: "authenticated" },
    authentication_method: "password",
  });
  assertEquals(parsed.success, true);
});

Deno.test("recusa corpo sem user_id", () => {
  const parsed = hookInputSchema.safeParse({
    claims: { role: "authenticated" },
  });
  assertEquals(parsed.success, false);
});

Deno.test("recusa user_id que não é uuid", () => {
  const parsed = hookInputSchema.safeParse({
    user_id: "nao-e-uuid",
    claims: {},
  });
  assertEquals(parsed.success, false);
});

Deno.test("recusa profile com papel fora da lista", () => {
  const parsed = profileRowSchema.safeParse({ role: "root", tenant_id: null });
  assertEquals(parsed.success, false);
});

Deno.test("flag ausente em app_metadata vira false", () => {
  const result = buildHookClaims(
    { role: "authenticated", app_metadata: { provider: "email" } },
    { role: "admin", tenant_id: TENANT_ID, active: true },
  );
  assertEquals(result.ok, true);
  if (result.ok) assertEquals(result.claims.must_change_password, false);
});

Deno.test("flag ausente com app_metadata inexistente vira false", () => {
  const result = buildHookClaims({ role: "authenticated" }, null);
  assertEquals(result.ok, true);
  if (result.ok) assertEquals(result.claims.must_change_password, false);
});

Deno.test("flag não booleana é recusada", () => {
  const result = buildHookClaims(
    { role: "authenticated", app_metadata: { must_change_password: "true" } },
    { role: "super_admin", tenant_id: null, active: true },
  );
  assertEquals(result, { ok: false, code: "identity_invalid" });
});

Deno.test("copia a flag booleana verdadeira de app_metadata", () => {
  const result = buildHookClaims(
    { role: "authenticated", app_metadata: { must_change_password: true } },
    { role: "super_admin", tenant_id: null, active: true },
  );
  assertEquals(result.ok, true);
  if (result.ok) assertEquals(result.claims.must_change_password, true);
});

Deno.test("emite user_role e tenant_id do profile e preserva role original", () => {
  const result = buildHookClaims(
    { sub: USER_ID, role: "authenticated", app_metadata: {} },
    { role: "professional", tenant_id: TENANT_ID, active: true },
  );
  assertEquals(result.ok, true);
  if (result.ok) {
    assertEquals(result.claims.role, "authenticated");
    assertEquals(result.claims.user_role, "professional");
    assertEquals(result.claims.tenant_id, TENANT_ID);
    assertEquals(result.claims.sub, USER_ID);
  }
});

Deno.test("sem profile devolve user_role e tenant_id nulos", () => {
  const result = buildHookClaims({ role: "authenticated" }, null);
  assertEquals(result.ok, true);
  if (result.ok) {
    assertEquals(result.claims.user_role, null);
    assertEquals(result.claims.tenant_id, null);
    assertEquals(result.claims.role, "authenticated");
    assertEquals(result.claims.active, false);
  }
});

Deno.test("perfil inativo emite claim active=false", () => {
  const result = buildHookClaims(
    { role: "authenticated" },
    { role: "professional", tenant_id: TENANT_ID, active: false },
  );
  assertEquals(result.ok, true);
  if (result.ok) assertEquals(result.claims.active, false);
});
