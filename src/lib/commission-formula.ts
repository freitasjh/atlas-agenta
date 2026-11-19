/**
 * Fórmula de comissão compartilhada entre UI (preview) e backend (ADR-04).
 * Espelha o trigger `appointments_validate_transition`: rounding half-up,
 * centavos inteiros. Usada no preview em tempo real e nos testes de paridade.
 */

export type CommissionType = "price" | "margin";
export type CommissionOrigin = "service" | "product" | "combo";

export interface ServiceCommissionInput {
  priceCents: number;
  commissionPct: number; // percentual 0-100 (não bps)
  commissionType?: CommissionType;
  backbarCostCents?: number;
}

export interface ProductCommissionInput {
  priceCents: number;
  qty?: number;
  commissionPct: number; // percentual 0-100
}

export function calcServiceCommissionCents(input: ServiceCommissionInput): number {
  const price = Math.max(0, Math.trunc(input.priceCents ?? 0));
  const pct = input.commissionPct ?? 0;
  const backbar = Math.max(0, Math.trunc(input.backbarCostCents ?? 0));
  const type = input.commissionType ?? "price";
  let base = price;
  if (type === "margin") base = price - backbar;
  const result = Math.round((base * pct) / 100);
  return result < 0 ? 0 : result;
}

export function calcProductCommissionCents(input: ProductCommissionInput): number {
  const price = Math.max(0, Math.trunc(input.priceCents ?? 0));
  const qty = input.qty ?? 1;
  const pct = input.commissionPct ?? 0;
  const result = Math.round((price * qty * pct) / 100);
  return result < 0 ? 0 : result;
}

export function calcComboCommissionCents(input: {
  priceCents: number;
  commissionPct: number;
}): number {
  return calcServiceCommissionCents({
    priceCents: input.priceCents,
    commissionPct: input.commissionPct,
    commissionType: "price",
    backbarCostCents: 0,
  });
}

// Aliases para compatibilidade com possíveis nomes de teste.
export const calculateServiceCommission = calcServiceCommissionCents;
export const calculateProductCommission = calcProductCommissionCents;
export const calculateComboCommission = calcComboCommissionCents;
export const previewCommission = calcServiceCommissionCents;

export const ORIGIN_LABELS: Record<CommissionOrigin, string> = {
  service: "Serviço",
  product: "Produto",
  combo: "Combo",
};