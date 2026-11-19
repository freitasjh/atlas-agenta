import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";

import { supabase } from "@/lib/supabase";
import {
  cancelamentoCobrancaSchema,
  cobrancaResponseSchema,
  isRecebivelStatus,
  RECEBIMENTO_METODOS,
  receivableErrorMessage,
  type CobrancaResponse,
  type CancelamentoCobranca,
  type Receivable,
  type ReceivableLedgerEntry,
} from "@/lib/receber";

/**
 * Hooks de contas a receber (Fase 5 ADR-07, UI).
 *
 * Leitura via RLS (admin-only; recepção/profissional sem SELECT — a trava é a
 * política). `enabled` vem do gating de segmento `payments`: `false`/`null` →
 * nenhuma query disparada.
 *
 * Agregação no banco: a lista vem da RPC `receivable_list`, que devolve o
 * `recebido_cents` somado por conta. Nada de agregar em memória sobre uma janela
 * limitada de `receivable_settlements` (perdia recebimentos antigos).
 *
 * Escrita: RPCs admin (`receivable_create`/`receivable_settle`/`receivable_cancel`)
 * e Edges `create-receivable-charge` (PIX idempotente) / `cancel-receivable-charge`
 * (mata o PIX antes de liberar a conta para baixa manual). Nenhuma linha é escrita
 * em `appointment_payments` — o ledger é SSoT readonly.
 */

export const RECEIVABLES_KEY = ["receber", "avulsas"] as const;
export const RECEIVABLE_LEDGER_KEY = ["receber", "ledger"] as const;

const receivableRowSchema = z.object({
  id: z.string(),
  tenant_id: z.string(),
  customer_id: z.string(),
  descricao: z.string(),
  categoria: z.string(),
  vencimento_at: z.string(),
  valor_cents: z.number().int(),
  status: z.string(),
  asaas_payment_id: z.string().nullable(),
  pix_qr_code: z.string().nullable(),
  pix_copy_paste: z.string().nullable(),
  charge_expires_at: z.string().nullable(),
  created_at: z.string(),
  recebido_cents: z.number().int().nonnegative().default(0),
});

const ledgerEntrySchema = z.object({
  id: z.string(),
  appointment_id: z.string(),
  method: z.string(),
  amount_cents: z.number().int(),
  tip_cents: z.number().int(),
  source: z.string(),
  received_at: z.string(),
  customer_name: z.string().nullable(),
  service_name: z.string().nullable(),
});

function toReceivable(raw: unknown): Receivable | null {
  const parsed = receivableRowSchema.safeParse(raw);
  if (!parsed.success) return null;
  if (!isRecebivelStatus(parsed.data.status)) return null;
  return { ...parsed.data, status: parsed.data.status };
}

export function useReceivables(enabled: boolean) {
  return useQuery<Receivable[]>({
    queryKey: RECEIVABLES_KEY,
    enabled,
    staleTime: 30 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("receivable_list");
      if (error) throw error;
      const parsed = z.array(z.unknown()).safeParse(data ?? []);
      if (!parsed.success) throw new Error("Resposta inválida das contas a receber.");
      return parsed.data
        .map(toReceivable)
        .filter((r): r is Receivable => r !== null);
    },
  });
}

/** Aba Atendimentos: ledger readonly pela RPC `security invoker` (RLS aplica). */
export function useReceivableLedger(fromIso: string | null, toIso: string | null, enabled: boolean) {
  return useQuery<ReceivableLedgerEntry[]>({
    queryKey: [...RECEIVABLE_LEDGER_KEY, fromIso, toIso],
    enabled: enabled && fromIso !== null && toIso !== null,
    staleTime: 30 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("receivable_ledger_list", {
        p_from: fromIso,
        p_to: toIso,
      });
      if (error) throw error;
      const parsed = z.array(ledgerEntrySchema).safeParse(data ?? []);
      if (!parsed.success) throw new Error("Resposta inválida do ledger.");
      return parsed.data;
    },
  });
}

export interface CreateReceivableInput {
  customer_id: string;
  descricao: string;
  categoria: string;
  vencimento_at: string;
  valor_cents: number;
}

export function useCreateReceivable() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateReceivableInput): Promise<{ receivable_id: string }> => {
      const { data, error } = await supabase.rpc("receivable_create", {
        p_customer_id: input.customer_id,
        p_descricao: input.descricao,
        p_valor_cents: input.valor_cents,
        p_vencimento_at: input.vencimento_at,
        p_categoria: input.categoria,
      });
      if (error) {
        throw new Error(receivableErrorMessage(error.message, "Não foi possível criar a cobrança."));
      }
      const parsed = z.object({ receivable_id: z.string() }).passthrough().safeParse(data);
      if (!parsed.success) throw new Error("Resposta inválida da criação.");
      return { receivable_id: parsed.data.receivable_id };
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: RECEIVABLES_KEY });
    },
  });
}

export interface SettleReceivableInput {
  receivable_id: string;
  valor_cents: number;
  recebido_at: string;
  metodo: (typeof RECEBIMENTO_METODOS)[number];
}

export function useSettleReceivable() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: SettleReceivableInput): Promise<{ status: string; resto_cents: number }> => {
      const { data, error } = await supabase.rpc("receivable_settle", {
        p_receivable_id: input.receivable_id,
        p_valor_cents: input.valor_cents,
        p_recebido_at: input.recebido_at,
        p_metodo: input.metodo,
      });
      if (error) {
        throw new Error(
          receivableErrorMessage(error.message, "Não foi possível registrar o recebimento."),
        );
      }
      const parsed = z
        .object({ status: z.string(), resto_cents: z.number() })
        .passthrough()
        .safeParse(data);
      if (!parsed.success) throw new Error("Resposta inválida do recebimento.");
      return { status: parsed.data.status, resto_cents: parsed.data.resto_cents };
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: RECEIVABLES_KEY });
    },
  });
}

export function useCancelReceivable() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { receivable_id: string; motivo: string | null }): Promise<{ status: string }> => {
      const { data, error } = await supabase.rpc("receivable_cancel", {
        p_receivable_id: input.receivable_id,
        p_motivo: input.motivo,
      });
      if (error) {
        throw new Error(receivableErrorMessage(error.message, "Não foi possível cancelar a conta."));
      }
      const parsed = z.object({ status: z.string() }).passthrough().safeParse(data);
      if (!parsed.success) throw new Error("Resposta inválida do cancelamento.");
      return { status: parsed.data.status };
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: RECEIVABLES_KEY });
    },
  });
}

/** Lê o corpo JSON do erro do `functions.invoke` sem confiar no shape. */
async function readEdgeError(error: unknown): Promise<{ code?: string; message?: string }> {
  const record = error as { context?: unknown } | null;
  const context = record?.context;
  if (context && typeof context === "object" && "clone" in context) {
    try {
      const body = (await (context as Response).clone().json()) as Record<string, unknown>;
      return {
        code: typeof body.code === "string" ? body.code : undefined,
        message: typeof body.message === "string" ? body.message : undefined,
      };
    } catch {
      return {};
    }
  }
  return {};
}

export interface ChargeReceivableInput {
  receivable_id: string;
  notify_whatsapp: boolean;
}

/**
 * Cobrança PIX da avulsa. `notify_whatsapp` sem opt-in → 422 da Edge com a
 * mensagem pt-BR; a UI exibe o motivo e nenhum PIX/mensagem é criado.
 */
export function useChargeReceivable() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: ChargeReceivableInput): Promise<CobrancaResponse> => {
      const { data, error } = await supabase.functions.invoke("create-receivable-charge", {
        body: {
          receivable_id: input.receivable_id,
          notify_whatsapp: input.notify_whatsapp,
        },
      });
      if (error) {
        const body = await readEdgeError(error);
        const raw = body.message ?? body.code;
        throw new Error(
          receivableErrorMessage(raw, "Não foi possível gerar a cobrança PIX."),
        );
      }
      const parsed = cobrancaResponseSchema.safeParse(data);
      if (!parsed.success) throw new Error("Resposta inválida da cobrança.");
      return parsed.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: RECEIVABLES_KEY });
    },
  });
}

/**
 * Cancela o PIX da avulsa no gateway. É o pré-requisito para voltar a conta ao
 * estado sem cobrança (a RPC recusa baixa/cancelamento com PIX vivo).
 */
export function useCancelReceivableCharge() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { receivable_id: string }): Promise<CancelamentoCobranca> => {
      const { data, error } = await supabase.functions.invoke("cancel-receivable-charge", {
        body: { receivable_id: input.receivable_id },
      });
      if (error) {
        const body = await readEdgeError(error);
        const raw = body.message ?? body.code;
        throw new Error(receivableErrorMessage(raw, "Não foi possível cancelar o PIX."));
      }
      const parsed = cancelamentoCobrancaSchema.safeParse(data);
      if (!parsed.success) throw new Error("Resposta inválida do cancelamento do PIX.");
      return parsed.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: RECEIVABLES_KEY });
    },
  });
}
