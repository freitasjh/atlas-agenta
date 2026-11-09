// Gate puro da Edge Function `admin-plan` — mesma ordem de `admin-subscription`:
// papel != super_admin → forbidden_role; mustChangePassword === true → password_change_required.
export type PlanGateRole =
  | "super_admin"
  | "admin"
  | "professional"
  | "receptionist";

export type PlanGateInput = {
  role: PlanGateRole | string;
  mustChangePassword: unknown;
  /** Prova server-side de operador interno ativo (internal_operators). */
  isOperator?: boolean;
  /** Nível de garantia de autenticação por request (só `aal2` libera super_admin). */
  aal?: string;
};

export type PlanGateDecision =
  | { allowed: true }
  | { allowed: false; code: "forbidden_role" | "password_change_required" | "operator_required" };

export function decidePlanGate(input: PlanGateInput): PlanGateDecision {
  if (input.role !== "super_admin") {
    return { allowed: false, code: "forbidden_role" };
  }
  if (input.mustChangePassword === true) {
    return { allowed: false, code: "password_change_required" };
  }
  if (input.isOperator !== true || input.aal !== "aal2") {
    return { allowed: false, code: "operator_required" };
  }
  return { allowed: true };
}
