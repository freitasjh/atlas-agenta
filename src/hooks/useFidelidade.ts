import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";

import { supabase } from "@/lib/supabase";
import {
  couponSchema,
  giftCardSchema,
  loyaltyAccountSchema,
  loyaltyProgramSchema,
  loyaltyTransactionSchema,
  type Coupon,
  type GiftCard,
  type LoyaltyAccount,
  type LoyaltyProgram,
  type LoyaltyTransaction,
} from "@/app/fidelidade/model";

/**
 * Hooks de fidelidade (Fase 4, ADR-15 sobre ADR-06/ADR-07).
 *
 * Leituras sob RLS do tenant; escritas de config/cupom/gift são admin
 * (trava real no RLS, defesa em profundidade no RBAC). Todas as queries
 * recebem `enabled` — sem entitlement `fidelidade` a página nem dispara
 * request sensível (gating RF-23).
 */

export const LOYALTY_PROGRAM_KEY = ["loyalty", "program"] as const;
export const LOYALTY_ACCOUNTS_KEY = ["loyalty", "accounts"] as const;
export const COUPONS_KEY = ["loyalty", "coupons"] as const;
export const GIFT_CARDS_KEY = ["loyalty", "gift-cards"] as const;

const programListSchema = z.array(loyaltyProgramSchema);

async function fetchProgram(): Promise<LoyaltyProgram | null> {
  const { data, error } = await supabase
    .from("loyalty_programs")
    .select("id, tenant_id, active, points_per_real, rounding, expiry_days, levels, updated_at")
    .limit(1);
  if (error) throw error;
  const rows = programListSchema.parse(data);
  return rows[0] ?? null;
}

export function useLoyaltyProgram(options?: { enabled?: boolean }) {
  const enabled = options?.enabled ?? true;
  return useQuery<LoyaltyProgram | null>({
    queryKey: LOYALTY_PROGRAM_KEY,
    queryFn: fetchProgram,
    enabled,
  });
}

export interface SaveProgramInput {
  active: boolean;
  points_per_real: number;
  rounding: "floor" | "nearest";
  expiry_days: number | null;
  levels: Array<{ name: string; min_points: number }> | null;
}

async function saveProgramRow(input: SaveProgramInput): Promise<LoyaltyProgram> {
  const { data: existing } = await supabase.from("loyalty_programs").select("id").limit(1).single();
  if (existing) {
    const { data, error } = await supabase
      .from("loyalty_programs")
      .update({
        active: input.active,
        points_per_real: input.points_per_real,
        rounding: input.rounding,
        expiry_days: input.expiry_days,
        levels: input.levels,
      })
      .eq("id", (existing as { id: string }).id)
      .select("id, tenant_id, active, points_per_real, rounding, expiry_days, levels, updated_at")
      .single();
    if (error) throw error;
    return loyaltyProgramSchema.parse(data);
  }
  const { data, error } = await supabase
    .from("loyalty_programs")
    .insert({
      active: input.active,
      points_per_real: input.points_per_real,
      rounding: input.rounding,
      expiry_days: input.expiry_days,
      levels: input.levels,
    })
    .select("id, tenant_id, active, points_per_real, rounding, expiry_days, levels, updated_at")
    .single();
  if (error) throw error;
  return loyaltyProgramSchema.parse(data);
}

export function useSaveLoyaltyProgram() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: saveProgramRow,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: LOYALTY_PROGRAM_KEY });
    },
  });
}

const accountListSchema = z.array(loyaltyAccountSchema);

async function fetchAccounts(): Promise<LoyaltyAccount[]> {
  const { data, error } = await supabase
    .from("loyalty_accounts")
    .select("id, tenant_id, customer_id, balance_points, lifetime_points")
    .order("lifetime_points", { ascending: false })
    .limit(100);
  if (error) throw error;
  return accountListSchema.parse(data);
}

export function useLoyaltyAccounts(options?: { enabled?: boolean }) {
  const enabled = options?.enabled ?? true;
  return useQuery<LoyaltyAccount[]>({
    queryKey: LOYALTY_ACCOUNTS_KEY,
    queryFn: fetchAccounts,
    enabled,
  });
}

const txListSchema = z.array(loyaltyTransactionSchema);

export function useLoyaltyTransactions(accountId: string | null, options?: { enabled?: boolean }) {
  const enabled = (options?.enabled ?? true) && accountId !== null;
  return useQuery<LoyaltyTransaction[]>({
    queryKey: ["loyalty", "transactions", accountId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("loyalty_transactions")
        .select("id, tenant_id, account_id, appointment_id, type, points, reason, expires_at, created_at")
        .eq("account_id", accountId as string)
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return txListSchema.parse(data);
    },
    enabled,
  });
}

const couponListSchema = z.array(couponSchema);

async function fetchCoupons(): Promise<Coupon[]> {
  const { data, error } = await supabase
    .from("coupons")
    .select("id, tenant_id, code, type, value, valid_from, valid_until, usage_limit, used_count, active")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return couponListSchema.parse(data);
}

export function useCoupons(options?: { enabled?: boolean }) {
  const enabled = options?.enabled ?? true;
  return useQuery<Coupon[]>({
    queryKey: COUPONS_KEY,
    queryFn: fetchCoupons,
    enabled,
  });
}

export interface SaveCouponInput {
  code: string;
  type: "percent" | "fixed";
  value: number;
  valid_until: string | null;
  usage_limit: number | null;
}

async function saveCouponRow(input: SaveCouponInput): Promise<Coupon> {
  const { data, error } = await supabase
    .from("coupons")
    .insert({
      code: input.code.toUpperCase(),
      type: input.type,
      value: input.value,
      valid_until: input.valid_until,
      usage_limit: input.usage_limit,
      active: true,
    })
    .select("id, tenant_id, code, type, value, valid_from, valid_until, usage_limit, used_count, active")
    .single();
  if (error) throw error;
  return couponSchema.parse(data);
}

export function useSaveCoupon() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: saveCouponRow,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: COUPONS_KEY });
    },
  });
}

const giftListSchema = z.array(giftCardSchema);

async function fetchGiftCards(): Promise<GiftCard[]> {
  const { data, error } = await supabase
    .from("gift_cards")
    .select("id, tenant_id, code, initial_value_cents, balance_cents, valid_until, status")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return giftListSchema.parse(data);
}

export function useGiftCards(options?: { enabled?: boolean }) {
  const enabled = options?.enabled ?? true;
  return useQuery<GiftCard[]>({
    queryKey: GIFT_CARDS_KEY,
    queryFn: fetchGiftCards,
    enabled,
  });
}

export interface IssueGiftCardInput {
  code: string;
  initial_value_cents: number;
  valid_until: string | null;
}

async function issueGiftCardRow(input: IssueGiftCardInput): Promise<GiftCard> {
  const { data, error } = await supabase
    .from("gift_cards")
    .insert({
      code: input.code.toUpperCase(),
      initial_value_cents: input.initial_value_cents,
      balance_cents: input.initial_value_cents,
      valid_until: input.valid_until,
      status: "active",
    })
    .select("id, tenant_id, code, initial_value_cents, balance_cents, valid_until, status")
    .single();
  if (error) throw error;
  return giftCardSchema.parse(data);
}

export function useIssueGiftCard() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: issueGiftCardRow,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: GIFT_CARDS_KEY });
    },
  });
}

const validateResponse = z.object({
  valid: z.boolean(),
  discount_cents: z.number().optional(),
  balance_cents: z.number().optional(),
  reason: z.string().nullable().optional(),
  coupon_id: z.string().optional(),
  total_final_cents: z.number().optional(),
});

export type ValidateResult = z.infer<typeof validateResponse>;

/**
 * Validação de cupom via RPC `coupon_validate(p_appointment_id, p_code)`
 * (saldo de usos, validade, segmento; desconto sobre o preço real).
 * Exige atendimento real — nunca validar no vazio do pré-cadastro.
 */
export function useValidateCoupon() {
  return useMutation({
    mutationFn: async (input: { appointmentId: string; code: string }) => {
      const { data, error } = await supabase.rpc("coupon_validate", {
        p_appointment_id: input.appointmentId,
        p_code: input.code,
      });
      if (error) throw error;
      return validateResponse.parse(data);
    },
  });
}

/** Validação de gift card via RPC `gift_card_validate` (saldo, validade). */
export function useValidateGiftCard() {
  return useMutation({
    mutationFn: async (code: string) => {
      const { data, error } = await supabase.rpc("gift_card_validate", { p_code: code });
      if (error) throw error;
      return validateResponse.parse(data);
    },
  });
}

const applyCouponResponse = z.object({
  appointment_id: z.string(),
  coupon_id: z.string(),
  discount_cents: z.number(),
  total_final_cents: z.number().optional(),
  applied: z.boolean(),
  replayed: z.boolean().optional().default(false),
});

export type ApplyCouponResult = z.infer<typeof applyCouponResponse>;

/**
 * Aplicação de cupom no fechamento (`apply_coupon_to_closing`) — idempotente
 * por `idempotencyKey`, um cupom por atendimento, com trilha em `audit_log`.
 */
export function useApplyCouponToClosing() {
  return useMutation({
    mutationFn: async (input: { appointmentId: string; code: string; idempotencyKey: string }) => {
      const { data, error } = await supabase.rpc("apply_coupon_to_closing", {
        p_appointment_id: input.appointmentId,
        p_code: input.code,
        p_idempotency_key: input.idempotencyKey,
      });
      if (error) throw error;
      return applyCouponResponse.parse(data);
    },
  });
}

const redeemGiftResponse = z.object({
  appointment_id: z.string(),
  gift_card_id: z.string(),
  amount_cents: z.number(),
  payment_id: z.string(),
  balance_cents: z.number().optional(),
  status: z.string().optional(),
  redeemed: z.boolean(),
  replayed: z.boolean().optional().default(false),
});

export type RedeemGiftResult = z.infer<typeof redeemGiftResponse>;

/**
 * Resgate de gift card no fechamento (`redeem_gift_card`) — idempotente por
 * `idempotencyKey`, vira linha `gift_card` no ledger + trilha em `audit_log`.
 */
export function useRedeemGiftCard() {
  return useMutation({
    mutationFn: async (input: {
      appointmentId: string;
      code: string;
      amountCents: number;
      idempotencyKey: string;
      lineIndex?: number;
    }) => {
      const { data, error } = await supabase.rpc("redeem_gift_card", {
        p_appointment_id: input.appointmentId,
        p_code: input.code,
        p_amount_cents: input.amountCents,
        p_idempotency_key: input.idempotencyKey,
        p_line_index: input.lineIndex ?? 0,
      });
      if (error) throw error;
      return redeemGiftResponse.parse(data);
    },
  });
}
