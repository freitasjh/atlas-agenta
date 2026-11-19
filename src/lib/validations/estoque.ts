import { z } from "zod";

export const productCategorySchema = z.enum(["backbar", "retail", "both"]);

export const productInputSchema = z.object({
  name: z.string().trim().min(1, "Nome obrigatório").max(120),
  sku: z.string().trim().max(60).nullable().optional(),
  category: productCategorySchema,
  unit: z.string().trim().min(1, "Unidade obrigatória").max(30),
  costCents: z.number().int().min(0),
  priceCents: z.number().int().min(0),
  minQty: z.number().int().min(0),
  active: z.boolean().default(true),
  commissionPct: z.number().min(0).max(100),
  professionalIds: z.array(z.string()).optional(),
});

export type ProductInput = z.infer<typeof productInputSchema>;

export const replenishInputSchema = z.object({
  productId: z.string().min(1),
  qty: z.number().int().positive("Quantidade deve ser maior que zero"),
  batch: z.string().trim().max(60).nullable().optional(),
  expiresAt: z.string().nullable().optional(),
  supplier: z.string().trim().max(120).nullable().optional(),
  unitCostCents: z.number().int().min(0).nullable().optional(),
});

export type ReplenishInput = z.infer<typeof replenishInputSchema>;

export const adjustInputSchema = z.object({
  productId: z.string().min(1),
  qtyDelta: z.number().int().refine((v) => v !== 0, "Ajuste não pode ser zero"),
  reason: z.string().trim().min(1, "Motivo obrigatório"),
});

export type AdjustInput = z.infer<typeof adjustInputSchema>;

export const inventoryCountSchema = z.object({
  productId: z.string().min(1),
  countedQty: z.number().int().min(0),
});

export type InventoryCount = z.infer<typeof inventoryCountSchema>;

export function productCategoryLabel(category: string): string {
  switch (category) {
    case "backbar":
      return "Backbar";
    case "retail":
      return "Varejo";
    case "both":
      return "Ambos";
    default:
      return category;
  }
}

export function stockStatusLabel(status: string): string {
  switch (status) {
    case "critical":
      return "Crítico";
    case "low":
      return "Baixo";
    case "ok":
      return "OK";
    default:
      return status;
  }
}