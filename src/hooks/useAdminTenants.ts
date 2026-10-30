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
 * Erro normalizado da Edge Function `admin-subscription`: carrega o `status`
 * HTTP e o texto de erro do corpo recuperados do canal de erro do
 * `functions.invoke`. É o que o dialog (ADR-07) passa para `mapSubscriptionError`
 * — que resolve a mensagem pt-BR por código HTTP (409/403/404/400/401). Sem o
 * `status`, o corpo não-2xx fica preso em `error.context` (uma `Response`) e
 * todos os casos caíam no genérico (CA-07).
 */
export interface AdminSubscriptionError extends Error {
  status?: number;
}

/**
 * Recupera `{ status, error }` do canal de erro do `functions.invoke` e devolve
 * um `AdminSubscriptionError` com o `status` HTTP e o texto do corpo embutidos
 * na `message`, para o mapeador pt-BR (síncrono, por regex de código/keyword)
 * enxergar o caso real. O corpo não-2xx do `FunctionsHttpError` vive em
 * `error.context` (uma `Response`), não em `error.message`; lê de forma
 * defensiva, como `readSendResponseFromError` em `useMessages.ts`. Nunca lança:
 * se não conseguir ler, repassa o status e o texto original disponíveis.
 */
export async function normalizeInvokeError(
  error: unknown,
): Promise<AdminSubscriptionError> {
  let status: number | undefined;
  let bodyText = "";

  if (typeof error === "object" && error !== null && "context" in error) {
    const context = (error as { context: unknown }).context;
    if (typeof context === "object" && context !== null) {
      const maybeStatus = (context as { status?: unknown }).status;
      if (typeof maybeStatus === "number") status = maybeStatus;

      if (typeof (context as { json?: unknown }).json === "function") {
        try {
          const body = await (
            context as { json: () => Promise<unknown> }
          ).json();
          if (typeof body === "object" && body !== null && "error" in body) {
            const value = (body as { error: unknown }).error;
            if (typeof value === "string") bodyText = value;
          }
        } catch {
          // Corpo ilegível (não-JSON / já consumido): mantém o status e a
          // mensagem original; o mapeador cai no genérico com segurança.
        }
      }
    }
  }

  const originalMessage =
    typeof error === "object" && error !== null && "message" in error
      ? String((error as { message: unknown }).message ?? "")
      : "";

  // Embute status + corpo + mensagem original para o mapeador (regex por
  // \b409\b / "transição" / etc.) resolver a mensagem pt-BR correta.
  const message = [status !== undefined ? String(status) : "", bodyText, originalMessage]
    .filter((part) => part.length > 0)
    .join(" ")
    .trim();

  const normalized: AdminSubscriptionError = new Error(
    message.length > 0 ? message : "admin-subscription invoke failed",
  );
  if (status !== undefined) normalized.status = status;
  return normalized;
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
      // O corpo não-2xx (409/403/404/400) vive em `error.context`, não em
      // `error.message`; normaliza para o dialog mapear a mensagem pt-BR certa.
      if (error) throw await normalizeInvokeError(error);
      return changeStatusResponseSchema.parse(data);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ADMIN_TENANTS_KEY });
    },
  });
}
