import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { supabase } from "@/lib/supabase";
import {
  adminTenantsResponseSchema,
  changeStatusResponseSchema,
  type ChangeStatusResponse,
} from "@/lib/validations/admin-subscription";
import type { SubscriptionStatus, TenantListItem } from "@/types/domain";

/**
 * Hooks de dados do Painel do Super Admin — Empresas (ADR-05), espelhando o
 * padrão de `useWhatsAppInstance.ts`: estado de servidor só por TanStack Query +
 * zod, nenhum `fetch` solto.
 *
 * Ponto de segurança: a leitura **não** filtra por `tenant_id` (`.eq`) — o RLS
 * `tenants_super_admin_select` (ADR-02) é a trava: super_admin lê tudo, qualquer
 * outro papel lê zero. Na escrita, `tenantId` vai no corpo como **alvo**, nunca
 * como credencial (o JWT é a credencial; a Edge Function `admin-subscription`
 * valida permissão e transição). Toda resposta — PostgREST ou Edge Function — é
 * dado não confiável, validado por zod antes do uso.
 */

/** Chave de cache única da lista de empresas; a mutation invalida esta mesma chave. */
export const ADMIN_TENANTS_KEY = ["admin", "tenants"] as const;

/** Colunas da projeção `TenantListItem` lidas cross-tenant sob RLS. */
const ADMIN_TENANTS_SELECT =
  "id, trade_name, legal_name, document, owner_email, plan, subscription_status, trial_ends_at, timezone, created_at";

/**
 * Lista de empresas (leitura cross-tenant). Sem `.eq("tenant_id", ...)`: o RLS
 * decide o que volta. Cada linha é validada por zod; shape inesperado lança e a
 * query entra em `isError` (a UI mostra o painel de erro). Busca/filtro são
 * estado de UI client-side (ADR-06) e **não** entram na `queryKey`.
 */
export function useAdminTenants() {
  return useQuery<TenantListItem[]>({
    queryKey: ADMIN_TENANTS_KEY,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tenants")
        .select(ADMIN_TENANTS_SELECT)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return adminTenantsResponseSchema.parse(data);
    },
  });
}

/** Alvo da mudança de status: a empresa, o status destino e o motivo opcional. */
export interface ChangeSubscriptionStatusInput {
  tenantId: string;
  status: SubscriptionStatus;
  reason?: string;
}

/**
 * Muda o `subscription_status` de uma empresa via Edge Function
 * `admin-subscription` (operação privilegiada, service role no servidor). O
 * corpo carrega `tenantId` como **alvo** — nunca `role`/`tenant_id` como
 * credencial. Em sucesso, invalida `ADMIN_TENANTS_KEY` para a lista refletir o
 * novo badge sem reload (R-05/CA-05). Em erro, **não** invalida (o estado não
 * mudou): o chamador (dialog, ADR-07) mapeia a mensagem com `mapSubscriptionError`.
 */
export function useChangeSubscriptionStatus() {
  const queryClient = useQueryClient();
  return useMutation<ChangeStatusResponse, Error, ChangeSubscriptionStatusInput>({
    mutationFn: async (input) => {
      const { data, error } = await supabase.functions.invoke("admin-subscription", {
        body: {
          action: "set_status",
          tenantId: input.tenantId,
          status: input.status,
          reason: input.reason,
        },
      });
      if (error) throw error;
      return changeStatusResponseSchema.parse(data);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ADMIN_TENANTS_KEY });
    },
  });
}
