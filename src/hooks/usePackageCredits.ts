import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";

import { supabase } from "@/lib/supabase";
import type { SellPackageInput } from "@/lib/validations/pacotes";
import type { PackageBalance, PackageCredit } from "@/types/domain";

/**
 * Hooks de dados de pacotes de sessões (Fase 2, ADR-02/ADR-06, TanStack Query).
 * UI fina sobre os RPCs — nenhuma lógica de saldo no cliente: o servidor é a
 * SSoT (`used_sessions` só anda no banco, via trigger ao `concluido`).
 *
 * - Leitura: `get_package_balance` (SECURITY INVOKER sob RLS) + SELECT direto
 *   em `package_credits` (sem policy de escrita — escrita só via RPCs).
 * - Escrita: `sell_package` (admin/receptionist; RLS nega o resto). Nunca envia
 *   `tenant_id` (o banco deriva do JWT).
 * - A baixa é efeito automático do concluir (trigger) — a UI nunca chama
 *   `redeem_session` direto após concluir.
 */

const packageCreditStatusSchema = z.enum(["active", "exhausted", "expired"]);

const packageBalanceRowSchema = z.object({
  credit_id: z.string(),
  service_id: z.string(),
  total_sessions: z.number().int(),
  used_sessions: z.number().int(),
  remaining: z.number().int(),
  expires_at: z.string(),
  expired: z.boolean(),
  status: packageCreditStatusSchema,
});

const packageBalanceListSchema = z.array(packageBalanceRowSchema);

const packageCreditRowSchema = z.object({
  id: z.string(),
  tenant_id: z.string(),
  customer_id: z.string(),
  service_id: z.string(),
  total_sessions: z.number().int(),
  used_sessions: z.number().int(),
  price_cents: z.number().int(),
  validity_days: z.number().int(),
  expires_at: z.string(),
  status: packageCreditStatusSchema,
  created_at: z.string(),
  customers: z.object({ name: z.string() }).nullable(),
  services: z.object({ name: z.string() }).nullable(),
});

const packageCreditListSchema = z.array(packageCreditRowSchema);

export type PackageCreditWithNames = PackageCredit & {
  customerName: string | null;
  serviceName: string | null;
};

const BALANCE_KEY = ["package-balance"] as const;
const CREDITS_KEY = ["package-credits"] as const;

/** Saldo de pacotes de um cliente (escopado por `get_package_balance`). */
export function usePackageBalance(customerId: string | null) {
  return useQuery<PackageBalance[]>({
    queryKey: [...BALANCE_KEY, { customerId }],
    enabled: !!customerId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_package_balance", {
        p_customer_id: customerId,
      });
      if (error) throw error;
      return packageBalanceListSchema.parse(data);
    },
  });
}

/** Todas as vendas de pacote do tenant (tela Config → Pacotes, admin). */
export function usePackageCredits(options?: { enabled?: boolean }) {
  return useQuery<PackageCreditWithNames[]>({
    queryKey: CREDITS_KEY,
    enabled: options?.enabled ?? true,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("package_credits")
        .select(
          "id, tenant_id, customer_id, service_id, total_sessions, used_sessions, price_cents, validity_days, expires_at, status, created_at, customers(name), services(name)",
        )
        .order("created_at", { ascending: false });
      if (error) throw error;
      return packageCreditListSchema.parse(data).map((row) => ({
        id: row.id,
        tenant_id: row.tenant_id,
        customer_id: row.customer_id,
        service_id: row.service_id,
        total_sessions: row.total_sessions,
        used_sessions: row.used_sessions,
        price_cents: row.price_cents,
        validity_days: row.validity_days,
        expires_at: row.expires_at,
        status: row.status,
        created_at: row.created_at,
        customerName: row.customers?.name ?? null,
        serviceName: row.services?.name ?? null,
      }));
    },
  });
}

/** Venda de pacote (`sell_package` — admin/receptionist). */
export function useSellPackage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: SellPackageInput) => {
      const { data, error } = await supabase.rpc("sell_package", {
        p_customer_id: input.customerId,
        p_service_id: input.serviceId,
        p_total_sessions: input.totalSessions,
        p_price_cents: input.priceCents,
        p_validity_days: input.validityDays,
      });
      if (error) throw error;
      return z.string().parse(data);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: BALANCE_KEY });
      void queryClient.invalidateQueries({ queryKey: CREDITS_KEY });
    },
  });
}

/** Erros tipados do banco (P0001/42501) → mensagens pt-BR sem PII. */
export function mapPackageError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (message.includes("PACKAGE_SELL_DENIED")) {
    return "Seu perfil não pode vender pacotes.";
  }
  if (message.includes("PACKAGE_REDEEM_DENIED")) {
    return "Seu perfil não pode baixar sessões manualmente.";
  }
  if (message.includes("PACKAGE_CREDIT_EXPIRED")) {
    return "Pacote vencido. Faça uma nova venda para continuar.";
  }
  if (message.includes("PACKAGE_CREDIT_EXHAUSTED")) {
    return "Saldo do pacote esgotado. Faça uma nova venda ou cobre avulso.";
  }
  if (message.includes("PACKAGE_CREDIT_AVAILABLE")) {
    return "Este atendimento tem sessão de pacote disponível. Conclua sem pagamento para usar o pacote.";
  }
  if (message.includes("PACKAGE_CREDIT_MISMATCH")) {
    return "Este pacote não vale para o serviço do atendimento.";
  }
  if (message.includes("PACKAGE_APPOINTMENT_NOT_CONCLUDED")) {
    return "Conclua o atendimento para baixar a sessão do pacote.";
  }
  if (message.includes("PACKAGE_SERVICE_NOT_FOUND_OR_INACTIVE")) {
    return "Serviço do pacote não encontrado ou inativo.";
  }
  if (message.includes("PACKAGE_CUSTOMER_NOT_FOUND")) {
    return "Cliente não encontrado.";
  }
  return "Não foi possível concluir. Verifique a conexão e tente de novo.";
}
