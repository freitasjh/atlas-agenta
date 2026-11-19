import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";

import { supabase } from "@/lib/supabase";
import type { Service } from "@/types/domain";
import {
  EMPTY_DEPOSIT_CONFIG,
  type DepositConfigInput,
} from "@/lib/validations/deposit";
import type { ServiceInput } from "@/lib/validations/catalog";

/**
 * Hooks de dados de `services` (TanStack Query). Toda leitura valida o shape de
 * retorno com zod; nenhuma escrita envia `tenant_id` (o RLS o deriva do JWT).
 * Inativar é **soft-delete** (`active = false`), nunca DELETE físico.
 */

const serviceRowSchema = z.object({
  id: z.string(),
  tenant_id: z.string(),
  name: z.string(),
  duration_minutes: z.number().int(),
  processing_minutes: z.number().int().default(0),
  price_cents: z.number().int(),
  backbar_cost_cents: z.number().int().default(0),
  active: z.boolean(),
  created_at: z.string(),
  /**
   * Config de depósito/sinal (Fase 4, ADR-02). Defaults defensivos: linhas de
   * backend anterior à migration não têm as colunas — ausência = desabilitado.
   */
  deposit_enabled: z.boolean().default(false),
  deposit_type: z.enum(["percent", "fixed"]).nullable().default(null),
  deposit_value: z.number().int().default(0),
  deposit_deadline_hours: z.number().int().default(24),
  deposit_refund_policy: z.enum(["total", "partial", "none"]).default("none"),
  deposit_refund_percent: z.number().int().nullable().default(null),
});

const SERVICE_COLUMNS =
  "id, tenant_id, name, duration_minutes, processing_minutes, price_cents, backbar_cost_cents, active, created_at, deposit_enabled, deposit_type, deposit_value, deposit_deadline_hours, deposit_refund_policy, deposit_refund_percent";

const serviceListSchema = z.array(serviceRowSchema);

const SERVICES_KEY = ["services"] as const;

/** Lista de serviços do tenant, opcionalmente só os ativos. */
export function useServices(options?: { activeOnly?: boolean }) {
  const activeOnly = options?.activeOnly ?? false;
  return useQuery<Service[]>({
    queryKey: [...SERVICES_KEY, { activeOnly }],
    queryFn: async () => {
      let query = supabase
        .from("services")
        .select(SERVICE_COLUMNS)
        .order("name", { ascending: true });
      if (activeOnly) query = query.eq("active", true);
      const { data, error } = await query;
      if (error) throw error;
      return serviceListSchema.parse(data);
    },
  });
}

/**
 * Mapeia o bloco `deposit` do form para as colunas `deposit_*` (ADR-02).
 * Bloco ausente/desabilitado = config zerada (enabled=false + defaults do
 * banco), nunca `undefined` parcial. Sem entitlement a chamada nem chega aqui
 * (o `ServiceFormDialog` faz o strip antes — zero request sensível).
 */
function toDepositColumns(deposit?: DepositConfigInput) {
  const cfg = deposit ?? EMPTY_DEPOSIT_CONFIG;
  if (!cfg.enabled) {
    return {
      deposit_enabled: false,
      deposit_type: null,
      deposit_value: 0,
      deposit_deadline_hours: 24,
      deposit_refund_policy: "none",
      deposit_refund_percent: null,
    } as const;
  }
  return {
    deposit_enabled: true,
    deposit_type: cfg.type,
    deposit_value: cfg.value,
    deposit_deadline_hours: cfg.deadlineHours,
    deposit_refund_policy: cfg.refundPolicy,
    deposit_refund_percent:
      cfg.refundPolicy === "partial" ? cfg.refundPercent : null,
  } as const;
}

export function useCreateService() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: ServiceInput) => {
      const { data, error } = await supabase
        .from("services")
        .insert({
          name: input.name,
          duration_minutes: input.durationMinutes,
          processing_minutes: input.processingMinutes ?? 0,
          price_cents: input.priceCents,
          backbar_cost_cents: input.backbarCostCents ?? 0,
          active: input.active,
          ...toDepositColumns(input.deposit),
        })
        .select(SERVICE_COLUMNS)
        .single();
      if (error) throw error;
      return serviceRowSchema.parse(data);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: SERVICES_KEY });
    },
  });
}

export function useUpdateService() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...input }: ServiceInput & { id: string }) => {
      const { data, error } = await supabase
        .from("services")
        .update({
          name: input.name,
          duration_minutes: input.durationMinutes,
          processing_minutes: input.processingMinutes ?? 0,
          price_cents: input.priceCents,
          backbar_cost_cents: input.backbarCostCents ?? 0,
          active: input.active,
          ...toDepositColumns(input.deposit),
        })
        .eq("id", id)
        .select(SERVICE_COLUMNS)
        .single();
      if (error) throw error;
      return serviceRowSchema.parse(data);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: SERVICES_KEY });
    },
  });
}

/** Soft-delete / reativação: alterna `active`. Nunca DELETE físico. */
export function useDeactivateService() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, active }: { id: string; active: boolean }) => {
      const { data, error } = await supabase
        .from("services")
        .update({ active })
        .eq("id", id)
        .select(SERVICE_COLUMNS)
        .single();
      if (error) throw error;
      return serviceRowSchema.parse(data);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: SERVICES_KEY });
    },
  });
}
