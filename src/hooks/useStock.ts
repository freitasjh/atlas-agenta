import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";

import { supabase } from "@/lib/supabase";
import type { StockAlert, StockMovement } from "@/types/domain";
import type { AdjustInput, ReplenishInput } from "@/lib/validations/estoque";

const stockMovementRowSchema = z.object({
  id: z.string(),
  tenant_id: z.string(),
  product_id: z.string(),
  movement_type: z.enum(["consume", "replenish", "adjust"]),
  qty_delta: z.number().int(),
  qty_before: z.number().int().nullable(),
  qty_after: z.number().int().nullable(),
  reason: z.string().nullable(),
  appointment_id: z.string().nullable(),
  batch: z.string().nullable(),
  expires_at: z.string().nullable(),
  supplier: z.string().nullable(),
  unit_cost_cents: z.number().int().nullable(),
  created_by: z.string().nullable(),
  created_at: z.string(),
});

const stockMovementListSchema = z.array(stockMovementRowSchema);

const stockAlertRowSchema = z.object({
  product_id: z.string(),
  product_name: z.string(),
  stock_qty: z.number().int(),
  min_qty: z.number().int(),
  status: z.enum(["ok", "low", "critical"]),
  next_expires_at: z.string().nullable().optional(),
});

const stockAlertListSchema = z.array(stockAlertRowSchema);

const lowStockRowSchema = z.object({
  product_id: z.string(),
  product_name: z.string(),
  stock_qty: z.number().int(),
  min_qty: z.number().int(),
  status: z.enum(["ok", "low", "critical"]),
});

const lowStockListSchema = z.array(lowStockRowSchema);

const STOCK_MOVEMENTS_KEY = ["stock-movements"] as const;
const STOCK_ALERTS_KEY = ["stock-alerts"] as const;
const LOW_STOCK_KEY = ["low-stock"] as const;

function rowToMovement(row: z.infer<typeof stockMovementRowSchema>): StockMovement {
  return {
    id: row.id,
    tenant_id: row.tenant_id,
    product_id: row.product_id,
    movement_type: row.movement_type,
    qty_delta: row.qty_delta,
    qty_before: row.qty_before,
    qty_after: row.qty_after,
    reason: row.reason,
    appointment_id: row.appointment_id,
    batch: row.batch,
    expires_at: row.expires_at,
    supplier: row.supplier,
    unit_cost_cents: row.unit_cost_cents,
    created_by: row.created_by,
    created_at: row.created_at,
  };
}

function rowToAlert(row: z.infer<typeof stockAlertRowSchema>): StockAlert {
  return {
    product_id: row.product_id,
    product_name: row.product_name,
    stock_qty: row.stock_qty,
    min_qty: row.min_qty,
    status: row.status,
    next_expires_at: row.next_expires_at ?? null,
  };
}

/** Lista paginada de movimentações de um produto. */
export function useStockMovements(productId: string | null) {
  return useQuery<StockMovement[]>({
    queryKey: [...STOCK_MOVEMENTS_KEY, { productId }],
    enabled: !!productId,
    queryFn: async () => {
      if (!productId) return [];
      const { data, error } = await supabase
        .from("stock_movements")
        .select("id, tenant_id, product_id, movement_type, qty_delta, qty_before, qty_after, reason, appointment_id, batch, expires_at, supplier, unit_cost_cents, created_by, created_at")
        .eq("product_id", productId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return stockMovementListSchema.parse(data).map(rowToMovement);
    },
  });
}

/** Alertas de estoque (low/critical + a vencer). */
export function useStockAlerts(options?: { enabled?: boolean }) {
  return useQuery<StockAlert[]>({
    queryKey: STOCK_ALERTS_KEY,
    enabled: options?.enabled ?? true,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_stock_alerts");
      if (error) throw error;
      return stockAlertListSchema.parse(data).map(rowToAlert);
    },
  });
}

/** Produtos com estoque baixo/crítico. */
export function useLowStock(options?: { enabled?: boolean }) {
  return useQuery<StockAlert[]>({
    queryKey: LOW_STOCK_KEY,
    enabled: options?.enabled ?? true,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("list_low_stock");
      if (error) throw error;
      // normalize to StockAlert (next_expires_at null)
      return lowStockListSchema.parse(data).map((r) => ({
        product_id: r.product_id,
        product_name: r.product_name,
        stock_qty: r.stock_qty,
        min_qty: r.min_qty,
        status: r.status,
        next_expires_at: null,
      }));
    },
  });
}

/** Reposição de estoque. */
export function useReplenishStock() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: ReplenishInput) => {
      const { data, error } = await supabase.rpc("replenish_stock", {
        p_product_id: input.productId,
        p_qty: input.qty,
        p_batch: input.batch ?? null,
        p_expires_at: input.expiresAt ?? null,
        p_supplier: input.supplier ?? null,
        p_unit_cost_cents: input.unitCostCents ?? null,
      });
      if (error) throw error;
      return z.string().parse(data);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: STOCK_ALERTS_KEY });
      void queryClient.invalidateQueries({ queryKey: LOW_STOCK_KEY });
      void queryClient.invalidateQueries({ queryKey: ["products"] });
      void queryClient.invalidateQueries({ queryKey: STOCK_MOVEMENTS_KEY });
    },
  });
}

/** Ajuste de inventário (motivo obrigatório, admin). */
export function useAdjustStock() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: AdjustInput) => {
      const { data, error } = await supabase.rpc("adjust_stock", {
        p_product_id: input.productId,
        p_qty_delta: input.qtyDelta,
        p_reason: input.reason,
      });
      if (error) throw error;
      return z.string().parse(data);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: STOCK_ALERTS_KEY });
      void queryClient.invalidateQueries({ queryKey: LOW_STOCK_KEY });
      void queryClient.invalidateQueries({ queryKey: ["products"] });
      void queryClient.invalidateQueries({ queryKey: STOCK_MOVEMENTS_KEY });
    },
  });
}

/** Baixa por atendimento (consume). */
export function useConsumeStock() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { productId: string; qty: number; appointmentId?: string | null; reason?: string | null }) => {
      const { data, error } = await supabase.rpc("consume_stock", {
        p_product_id: input.productId,
        p_qty: input.qty,
        p_appointment_id: input.appointmentId ?? null,
        p_reason: input.reason ?? null,
      });
      if (error) throw error;
      return z.string().parse(data);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: STOCK_ALERTS_KEY });
      void queryClient.invalidateQueries({ queryKey: LOW_STOCK_KEY });
      void queryClient.invalidateQueries({ queryKey: ["products"] });
      void queryClient.invalidateQueries({ queryKey: STOCK_MOVEMENTS_KEY });
    },
  });
}

// Combined alias sometimes expected
export function useStock(options?: { enabled?: boolean }) {
  return useStockAlerts(options);
}

// Aliases
export const useStockLevels = useStockAlerts;
export const useStockList = useStockAlerts;
export const useStockQuery = useStock;
export const useStockAlertsQuery = useStockAlerts;
export const useLowStockQuery = useLowStock;
export const useReplenish = useReplenishStock;
export const useAdjust = useAdjustStock;
export const useConsume = useConsumeStock;
export const useReplenishMutation = useReplenishStock;
export const useAdjustMutation = useAdjustStock;