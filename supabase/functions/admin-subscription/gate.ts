// Gate puro da Edge Function `admin-subscription` — ADR-06 (troca de senha no Auth nativo).
//
// A decisão é separada do HTTP e do banco para ser testada sem rede: quem chama só precisa do
// papel resolvido em `profiles` e do valor CRU de `app_metadata.must_change_password`.
//
// Regras, nesta ordem:
//  - papel diferente de `super_admin` → `forbidden_role` (a ação é exclusiva do super admin, R-06);
//  - `mustChangePassword === true` (booleano) → `password_change_required` (RQ-07/RQ-18);
//  - `false`, ausente ou QUALQUER valor não booleano → libera.
//
// A flag é dado não confiável: `"true"` (string), `1`, `"false"` e `null` NÃO bloqueiam. O bloqueio
// vale só para o booleano `true` gravado pelo Auth, e o desconhecido é tratado como ausente — é o
// comportamento desta ADR. Recusar identidade com flag não booleana é decisão do hook
// `custom-access-token` (ADR-01), não desta função.
//
// O `role` vem de `profiles` (fonte da verdade). NUNCA de `user_metadata`.

export type SubscriptionGateRole =
  | "super_admin"
  | "admin"
  | "professional"
  | "receptionist";

export type SubscriptionGateInput = {
  role: SubscriptionGateRole | string;
  /** Valor CRU de `app_metadata.must_change_password`; `undefined` quando ausente. */
  mustChangePassword: unknown;
};

export type SubscriptionGateDecision =
  | { allowed: true }
  | { allowed: false; code: "forbidden_role" | "password_change_required" };

/**
 * Decide se a ação de assinatura pode seguir. Função pura: sem I/O, sem relógio, sem rede — a
 * mesma entrada devolve sempre a mesma decisão.
 */
export function decideSubscriptionGate(
  input: SubscriptionGateInput,
): SubscriptionGateDecision {
  if (input.role !== "super_admin") {
    return { allowed: false, code: "forbidden_role" };
  }
  if (input.mustChangePassword === true) {
    return { allowed: false, code: "password_change_required" };
  }
  return { allowed: true };
}
