// Testes do gate puro de `admin-subscription` (ADR-06). Rodar com:
//   deno test supabase/functions/admin-subscription/gate.test.ts
//
// Nenhum fake, nenhum servidor: a função é pura, então a tabela de casos é o contrato.
// O que importa aqui é a falha segura da flag: só o booleano `true` bloqueia; string `"true"`,
// número e ausência são tratados como ausentes.
import { deepStrictEqual as assertEquals } from "node:assert/strict";
import { decideSubscriptionGate } from "./gate.ts";

const ALLOWED = { allowed: true } as const;

Deno.test("super admin com flag true booleana é bloqueado por password_change_required", () => {
  assertEquals(
    decideSubscriptionGate({ role: "super_admin", mustChangePassword: true }),
    { allowed: false, code: "password_change_required" },
  );
});

Deno.test("super admin com flag false passa", () => {
  assertEquals(
    decideSubscriptionGate({ role: "super_admin", mustChangePassword: false }),
    ALLOWED,
  );
});

Deno.test("super admin sem flag (undefined) passa", () => {
  assertEquals(
    decideSubscriptionGate({ role: "super_admin", mustChangePassword: undefined }),
    ALLOWED,
  );
});

Deno.test("super admin com flag null passa (ausente)", () => {
  assertEquals(
    decideSubscriptionGate({ role: "super_admin", mustChangePassword: null }),
    ALLOWED,
  );
});

Deno.test("string 'true' NÃO bloqueia: não confia em valor não booleano", () => {
  assertEquals(
    decideSubscriptionGate({ role: "super_admin", mustChangePassword: "true" }),
    ALLOWED,
  );
});

Deno.test("string 'false' passa", () => {
  assertEquals(
    decideSubscriptionGate({ role: "super_admin", mustChangePassword: "false" }),
    ALLOWED,
  );
});

Deno.test("número 1 NÃO bloqueia", () => {
  assertEquals(
    decideSubscriptionGate({ role: "super_admin", mustChangePassword: 1 }),
    ALLOWED,
  );
});

Deno.test("objeto com mustChangePassword true não bloqueia (valor não booleano)", () => {
  assertEquals(
    decideSubscriptionGate({
      role: "super_admin",
      mustChangePassword: { value: true },
    }),
    ALLOWED,
  );
});

Deno.test("papel diferente de super_admin é recusado com forbidden_role", () => {
  for (const role of ["admin", "professional", "receptionist", "authenticated", ""]) {
    assertEquals(
      decideSubscriptionGate({ role, mustChangePassword: false }),
      { allowed: false, code: "forbidden_role" },
    );
  }
});

Deno.test("papel proibido vence a flag: recusa é forbidden_role, não password_change_required", () => {
  assertEquals(
    decideSubscriptionGate({ role: "admin", mustChangePassword: true }),
    { allowed: false, code: "forbidden_role" },
  );
});

Deno.test("super_admin sem flag e papel exato libera", () => {
  assertEquals(decideSubscriptionGate({ role: "super_admin", mustChangePassword: false }), ALLOWED);
});
