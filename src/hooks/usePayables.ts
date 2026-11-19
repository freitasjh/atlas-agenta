import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";

import { supabase } from "@/lib/supabase";
import {
  isPayableStatus,
  type Payable,
  type PayableKpis,
  type PayableSettlement,
  type PayableStatus,
  type Supplier,
} from "@/lib/pagar";

/**
 * Hooks de contas a pagar (Fase 5 ADR-06, UI).
 *
 * Leitura via RLS (admin-only; recepção/profissional sem SELECT — a trava real
 * é a política, nunca filtro de `tenant_id` no cliente). `enabled` vem do
 * gating `contasPagar` da página: `false`/`null` → queries desabilitadas,
 * zero request a `suppliers`/`payables`/`payable_*` (critério ADR-06 §3).
 *
 * Escrita só via RPCs (`payable_create_supplier`, `payable_create` com expansão
 * de recorrência + replay por serie, `payable_settle` com resto, `payable_cancel`).
 * Anexo sobe ao bucket privado `payables/` no path `<tenant_id>/<payable_id>/*`.
 */

export const SUPPLIERS_KEY = ["pagar", "suppliers"] as const;
export const PAYABLES_KEY = ["pagar", "payables"] as const;
export const PAYABLE_KPIS_KEY = ["pagar", "kpis"] as const;

const supplierRowSchema = z.object({
  id: z.string(),
  tenant_id: z.string(),
  nome: z.string(),
  documento: z.string().nullable(),
  contato: z.string().nullable(),
  ativo: z.boolean(),
  created_at: z.string(),
});

const payableRowSchema = z.object({
  id: z.string(),
  tenant_id: z.string(),
  supplier_id: z.string().nullable(),
  descricao: z.string(),
  categoria: z.string().nullable(),
  vencimento_at: z.string(),
  valor_cents: z.number(),
  status: z.string(),
  recorrencia: z.enum(["none", "mensal"]).catch("none"),
  serie_id: z.string().nullable(),
  created_at: z.string(),
});

const settlementRowSchema = z.object({
  id: z.string(),
  tenant_id: z.string(),
  payable_id: z.string(),
  valor_cents: z.number(),
  pago_at: z.string(),
  conta: z.string().nullable(),
  anexo_path: z.string().nullable(),
  created_by: z.string().nullable(),
  created_at: z.string(),
});

const kpisSchema = z.object({
  vencido_cents: z.number(),
  vencido_count: z.number(),
  proximos7d_cents: z.number(),
  proximos7d_count: z.number(),
});

export interface PayableFiltros {
  status?: PayableStatus;
  supplierId?: string;
  ateVencimento?: string;
}

const SUPPLIERS_SELECT = "id, tenant_id, nome, documento, contato, ativo, created_at";
const PAYABLES_SELECT =
  "id, tenant_id, supplier_id, descricao, categoria, vencimento_at, valor_cents, status, recorrencia, serie_id, created_at";

function toSupplier(raw: unknown): Supplier | null {
  const parsed = supplierRowSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

function toPayable(raw: unknown): Payable | null {
  const parsed = payableRowSchema.safeParse(raw);
  if (!parsed.success) return null;
  if (!isPayableStatus(parsed.data.status)) return null;
  return { ...parsed.data, status: parsed.data.status };
}

function toSettlement(raw: unknown): PayableSettlement | null {
  const parsed = settlementRowSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export function useSuppliers(enabled: boolean) {
  return useQuery<Supplier[]>({
    queryKey: SUPPLIERS_KEY,
    enabled,
    staleTime: 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("suppliers")
        .select(SUPPLIERS_SELECT)
        .eq("ativo", true)
        .order("nome", { ascending: true })
        .limit(200);
      if (error) throw error;
      return ((data ?? []) as unknown[]).map(toSupplier).filter((s): s is Supplier => s !== null);
    },
  });
}

export function usePayables(filtros: PayableFiltros, enabled: boolean) {
  return useQuery<Payable[]>({
    queryKey: [...PAYABLES_KEY, filtros.status ?? "todas", filtros.supplierId ?? "todos", filtros.ateVencimento ?? "sem-limite"],
    enabled,
    staleTime: 30 * 1000,
    queryFn: async () => {
      let query = supabase.from("payables").select(PAYABLES_SELECT).order("vencimento_at", { ascending: true }).limit(200);
      if (filtros.status !== undefined) query = query.eq("status", filtros.status);
      if (filtros.supplierId !== undefined) query = query.eq("supplier_id", filtros.supplierId);
      if (filtros.ateVencimento !== undefined) query = query.lte("vencimento_at", filtros.ateVencimento);
      const { data, error } = await query;
      if (error) throw error;
      return ((data ?? []) as unknown[]).map(toPayable).filter((p): p is Payable => p !== null);
    },
  });
}

export function usePayableSettlements(payableId: string | null, enabled: boolean) {
  return useQuery<PayableSettlement[]>({
    queryKey: [...PAYABLES_KEY, "baixas", payableId],
    enabled: enabled && payableId !== null,
    staleTime: 30 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("payable_settlements")
        .select("id, tenant_id, payable_id, valor_cents, pago_at, conta, anexo_path, created_by, created_at")
        .eq("payable_id", payableId as string)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return ((data ?? []) as unknown[]).map(toSettlement).filter((s): s is PayableSettlement => s !== null);
    },
  });
}

export function usePayableKpis(enabled: boolean) {
  return useQuery<PayableKpis>({
    queryKey: PAYABLE_KPIS_KEY,
    enabled,
    staleTime: 30 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("payable_kpis");
      if (error) throw error;
      const parsed = kpisSchema.safeParse(data);
      if (!parsed.success) throw new Error("Resposta inválida dos indicadores.");
      return parsed.data;
    },
  });
}

export interface CreatePayableInput {
  descricao: string;
  vencimento_at: string;
  valor_cents: number;
  supplier_id: string | null;
  categoria: string | null;
  recorrencia: "none" | "mensal";
  parcelas: number;
}

export function useCreateSupplier() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { nome: string; documento?: string; contato?: string }): Promise<string> => {
      const { data, error } = await supabase.rpc("payable_create_supplier", {
        p_nome: input.nome,
        p_documento: input.documento ?? null,
        p_contato: input.contato ?? null,
      });
      if (error) throw new Error(error.message ?? "Não foi possível cadastrar o fornecedor.");
      if (typeof data !== "string") throw new Error("Resposta inválida do cadastro.");
      return data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: SUPPLIERS_KEY });
    },
  });
}

export function useCreatePayable() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreatePayableInput): Promise<{ payable_ids: string[]; replayed: boolean }> => {
      const { data, error } = await supabase.rpc("payable_create", {
        p_descricao: input.descricao,
        p_vencimento_at: input.vencimento_at,
        p_valor_cents: input.valor_cents,
        p_supplier_id: input.supplier_id,
        p_categoria: input.categoria,
        p_recorrencia: input.recorrencia,
        p_parcelas: input.recorrencia === "mensal" ? input.parcelas : 1,
        p_serie_id: null,
      });
      if (error) throw new Error(error.message ?? "Não foi possível lançar a conta.");
      const parsed = z.object({ payable_ids: z.array(z.string()), replayed: z.boolean() }).safeParse(data);
      if (!parsed.success) throw new Error("Resposta inválida do lançamento.");
      return parsed.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: PAYABLES_KEY });
      void queryClient.invalidateQueries({ queryKey: PAYABLE_KPIS_KEY });
    },
  });
}

export interface SettlePayableInput {
  payable_id: string;
  valor_cents: number;
  pago_at: string;
  conta: string | null;
  anexo_path: string | null;
}

export function useSettlePayable() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: SettlePayableInput): Promise<{ status: string; resto_cents: number }> => {
      const { data, error } = await supabase.rpc("payable_settle", {
        p_payable_id: input.payable_id,
        p_valor_cents: input.valor_cents,
        p_pago_at: input.pago_at,
        p_conta: input.conta,
        p_anexo_path: input.anexo_path,
      });
      if (error) throw new Error(error.message ?? "Não foi possível registrar a baixa.");
      const parsed = z.object({ status: z.string(), resto_cents: z.number() }).passthrough().safeParse(data);
      if (!parsed.success) throw new Error("Resposta inválida da baixa.");
      return { status: parsed.data.status, resto_cents: parsed.data.resto_cents };
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: PAYABLES_KEY });
      void queryClient.invalidateQueries({ queryKey: PAYABLE_KPIS_KEY });
    },
  });
}

export interface CancelPayableInput {
  payable_id: string;
  motivo: string | null;
}

export function useCancelPayable() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CancelPayableInput): Promise<{ status: string }> => {
      const { data, error } = await supabase.rpc("payable_cancel", {
        p_payable_id: input.payable_id,
        p_motivo: input.motivo,
      });
      if (error) throw new Error(error.message ?? "Não foi possível cancelar a conta.");
      const parsed = z.object({ status: z.string() }).passthrough().safeParse(data);
      if (!parsed.success) throw new Error("Resposta inválida do cancelamento.");
      return { status: parsed.data.status };
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: PAYABLES_KEY });
      void queryClient.invalidateQueries({ queryKey: PAYABLE_KPIS_KEY });
    },
  });
}

export const PAYABLES_BUCKET = "payables";
