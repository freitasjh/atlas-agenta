// Testes do gate puro `admin-plan`.
import { strictEqual } from "node:assert/strict";
import { decidePlanGate } from "./gate.ts";

Deno.test("super_admin operador com aal2: allowed", () => {
  strictEqual(
    decidePlanGate({ role: "super_admin", mustChangePassword: false, isOperator: true, aal: "aal2" }).allowed,
    true,
  );
});

Deno.test("super_admin sem prova de operador: operator_required", () => {
  const d = decidePlanGate({ role: "super_admin", mustChangePassword: false });
  strictEqual(d.allowed, false);
  if (!d.allowed) strictEqual(d.code, "operator_required");
});

Deno.test("super_admin operador sem aal2: operator_required", () => {
  const d = decidePlanGate({ role: "super_admin", mustChangePassword: false, isOperator: true, aal: "aal1" });
  strictEqual(d.allowed, false);
  if (!d.allowed) strictEqual(d.code, "operator_required");
});

Deno.test("admin: forbidden_role", () => {
  const d = decidePlanGate({ role: "admin", mustChangePassword: false });
  strictEqual(d.allowed, false);
});

Deno.test("super_admin com flag true: password_change_required", () => {
  const d = decidePlanGate({ role: "super_admin", mustChangePassword: true });
  strictEqual(d.allowed, false);
  if (!d.allowed) strictEqual(d.code, "password_change_required");
});

Deno.test("flag string 'true' não bloqueia (com operador+aal2)", () => {
  strictEqual(
    decidePlanGate({ role: "super_admin", mustChangePassword: "true", isOperator: true, aal: "aal2" }).allowed,
    true,
  );
});
