import { z } from "zod";

export const LOYALTY_TRANSACTION_TYPES = ["credit", "debit", "expire", "void"] as const;
export type LoyaltyTransactionType = (typeof LOYALTY_TRANSACTION_TYPES)[number];

export const COUPON_TYPES = ["percent", "fixed"] as const;
export type CouponType = (typeof COUPON_TYPES)[number];

export const GIFT_CARD_STATUSES = ["active", "exhausted", "expired", "cancelled"] as const;
export type GiftCardStatus = (typeof GIFT_CARD_STATUSES)[number];

export const loyaltyProgramSchema = z.object({
  id: z.string().optional(),
  tenant_id: z.string(),
  active: z.boolean(),
  points_per_real: z.number().min(0),
  rounding: z.enum(["floor", "nearest"]).default("floor"),
  expiry_days: z.number().int().min(0).nullable(),
  levels: z.array(z.object({ name: z.string(), min_points: z.number().int().min(0) })).nullable().default(null),
  updated_at: z.string().optional(),
});

export type LoyaltyProgram = z.infer<typeof loyaltyProgramSchema>;

export const loyaltyAccountSchema = z.object({
  id: z.string(),
  tenant_id: z.string(),
  customer_id: z.string(),
  balance_points: z.number().int(),
  lifetime_points: z.number().int(),
});

export type LoyaltyAccount = z.infer<typeof loyaltyAccountSchema>;

export const loyaltyTransactionSchema = z.object({
  id: z.string(),
  tenant_id: z.string(),
  account_id: z.string(),
  appointment_id: z.string().nullable(),
  type: z.enum(LOYALTY_TRANSACTION_TYPES),
  points: z.number().int(),
  reason: z.string().nullable(),
  expires_at: z.string().nullable(),
  created_at: z.string(),
});

export type LoyaltyTransaction = z.infer<typeof loyaltyTransactionSchema>;

export const couponSchema = z.object({
  id: z.string(),
  tenant_id: z.string(),
  code: z.string().min(3),
  type: z.enum(COUPON_TYPES),
  value: z.number().int().min(1),
  valid_from: z.string().nullable(),
  valid_until: z.string().nullable(),
  usage_limit: z.number().int().nullable(),
  used_count: z.number().int().default(0),
  active: z.boolean(),
});

export type Coupon = z.infer<typeof couponSchema>;

export const giftCardSchema = z.object({
  id: z.string(),
  tenant_id: z.string(),
  code: z.string().min(4),
  initial_value_cents: z.number().int().min(1),
  balance_cents: z.number().int().min(0),
  valid_until: z.string().nullable(),
  status: z.enum(GIFT_CARD_STATUSES),
});

export type GiftCard = z.infer<typeof giftCardSchema>;

export const loyaltyProgramFormSchema = z.object({
  active: z.boolean(),
  points_per_real: z.coerce.number().min(0, "Informe pontos por real (0 desativa o crédito).").max(1000),
  rounding: z.enum(["floor", "nearest"]),
  expiry_days: z.string().optional(),
  levels_text: z.string().optional(),
});

export type LoyaltyProgramFormValues = z.infer<typeof loyaltyProgramFormSchema>;

export interface LoyaltyLevel {
  name: string;
  min_points: number;
}

/**
 * Níveis no formato `Nome:pontos` (um por linha; `,` também separa).
 * Linha inválida é ignorada; vazio vira `null` (sem níveis).
 */
export function parseLevelsText(text: string | undefined): LoyaltyLevel[] | null {
  if (!text || text.trim() === "") return null;
  const levels: LoyaltyLevel[] = [];
  for (const part of text.split(/[\r\n,]+/)) {
    const chunk = part.trim();
    if (chunk === "") continue;
    const separator = chunk.lastIndexOf(":");
    if (separator <= 0) continue;
    const name = chunk.slice(0, separator).trim();
    const min = Number.parseInt(chunk.slice(separator + 1).trim(), 10);
    if (name === "" || !Number.isFinite(min) || min < 0) continue;
    levels.push({ name, min_points: min });
  }
  if (levels.length === 0) return null;
  return [...levels].sort((a, b) => a.min_points - b.min_points);
}

/** Serializa níveis para o editor (`Nome:pontos`, um por linha). */
export function formatLevelsText(levels: LoyaltyLevel[] | null | undefined): string {
  if (!levels || levels.length === 0) return "";
  return [...levels]
    .sort((a, b) => a.min_points - b.min_points)
    .map((level) => `${level.name}:${level.min_points}`)
    .join("\n");
}

export function formToProgramPayload(values: LoyaltyProgramFormValues): {
  active: boolean;
  points_per_real: number;
  rounding: "floor" | "nearest";
  expiry_days: number | null;
  levels: LoyaltyLevel[] | null;
} {
  const expiry = (values.expiry_days ?? "").trim();
  return {
    active: values.active,
    points_per_real: values.points_per_real,
    rounding: values.rounding,
    expiry_days: expiry === "" ? null : Math.max(0, Number.parseInt(expiry, 10) || 0),
    levels: parseLevelsText(values.levels_text),
  };
}

export const couponFormSchema = z.object({
  code: z.string().min(3, "O código deve ter ao menos 3 caracteres.").max(32),
  type: z.enum(COUPON_TYPES),
  value: z.coerce.number().int().min(1, "Informe um valor positivo."),
  valid_until: z.string().optional(),
  usage_limit: z.string().optional(),
});

export type CouponFormValues = z.infer<typeof couponFormSchema>;

export const giftCardFormSchema = z.object({
  code: z.string().min(4, "O código deve ter ao menos 4 caracteres.").max(32),
  initial_value_cents: z.number().int().min(100, "O valor mínimo é R$ 1,00."),
  valid_until: z.string().optional(),
});

export type GiftCardFormValues = z.infer<typeof giftCardFormSchema>;

/** Desconto de cupom sobre total em cents (percent 1-100 ou fixed em cents). */
export function couponDiscountCents(coupon: Pick<Coupon, "type" | "value">, totalCents: number): number {
  if (!Number.isFinite(totalCents) || totalCents <= 0) return 0;
  if (coupon.type === "percent") {
    const pct = Math.min(100, Math.max(0, coupon.value));
    return Math.min(totalCents, Math.floor((totalCents * pct) / 100));
  }
  return Math.min(totalCents, Math.max(0, coupon.value));
}

/** Nível atual pelos pontos acumulados (levels ordenados por min_points). */
export function loyaltyLevelFor(
  levels: Array<{ name: string; min_points: number }> | null | undefined,
  balance: number,
): string | null {
  if (!levels || levels.length === 0) return null;
  const sorted = [...levels].sort((a, b) => a.min_points - b.min_points);
  let current: string | null = null;
  for (const level of sorted) {
    if (balance >= level.min_points) current = level.name;
  }
  return current;
}

export function transactionTypeLabel(type: LoyaltyTransactionType): string {
  switch (type) {
    case "credit":
      return "Crédito";
    case "debit":
      return "Resgate";
    case "expire":
      return "Expirado";
    case "void":
      return "Estornado";
  }
}
