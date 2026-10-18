import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";

import { supabase } from "@/lib/supabase";
import type { Customer } from "@/types/domain";

/**
 * Hooks de dados de `customers` (TanStack Query). Toda leitura valida o shape de
 * retorno com zod; nenhuma escrita envia `tenant_id` (o RLS o deriva do JWT).
 * Inativar é **soft-delete** (`active = false`), nunca DELETE físico.
 *
 * `whatsapp_opt_in` registra o consentimento LGPD antes de qualquer disparo — é
 * campo gravável do formulário (ADR-07). PII (telefone/e-mail) nunca é logada em
 * claro: em erro, `mapSchedulingError` expõe só o técnico.
 */

const customerRowSchema = z.object({
  id: z.string(),
  tenant_id: z.string(),
  name: z.string(),
  phone: z.string(),
  email: z.string().nullable(),
  whatsapp_opt_in: z.boolean(),
  active: z.boolean(),
  created_at: z.string(),
});

const customerListSchema = z.array(customerRowSchema);

const CUSTOMERS_KEY = ["customers"] as const;

/** Campos graváveis de um cliente (derivados do formulário — ADR-07). */
export interface CustomerInput {
  name: string;
  phone: string;
  email: string | null;
  whatsappOptIn: boolean;
  active: boolean;
}

/** Lista de clientes do tenant, opcionalmente só os ativos. */
export function useCustomers(options?: { activeOnly?: boolean }) {
  const activeOnly = options?.activeOnly ?? false;
  return useQuery<Customer[]>({
    queryKey: [...CUSTOMERS_KEY, { activeOnly }],
    queryFn: async () => {
      let query = supabase
        .from("customers")
        .select(
          "id, tenant_id, name, phone, email, whatsapp_opt_in, active, created_at",
        )
        .order("name", { ascending: true });
      if (activeOnly) query = query.eq("active", true);
      const { data, error } = await query;
      if (error) throw error;
      return customerListSchema.parse(data);
    },
  });
}

export function useCreateCustomer() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CustomerInput) => {
      const { data, error } = await supabase
        .from("customers")
        .insert({
          name: input.name,
          phone: input.phone,
          email: input.email,
          whatsapp_opt_in: input.whatsappOptIn,
          active: input.active,
        })
        .select(
          "id, tenant_id, name, phone, email, whatsapp_opt_in, active, created_at",
        )
        .single();
      if (error) throw error;
      return customerRowSchema.parse(data);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: CUSTOMERS_KEY });
    },
  });
}

export function useUpdateCustomer() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...input }: CustomerInput & { id: string }) => {
      const { data, error } = await supabase
        .from("customers")
        .update({
          name: input.name,
          phone: input.phone,
          email: input.email,
          whatsapp_opt_in: input.whatsappOptIn,
          active: input.active,
        })
        .eq("id", id)
        .select(
          "id, tenant_id, name, phone, email, whatsapp_opt_in, active, created_at",
        )
        .single();
      if (error) throw error;
      return customerRowSchema.parse(data);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: CUSTOMERS_KEY });
    },
  });
}

/** Soft-delete / reativação: alterna `active`. Nunca DELETE físico. */
export function useDeactivateCustomer() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, active }: { id: string; active: boolean }) => {
      const { data, error } = await supabase
        .from("customers")
        .update({ active })
        .eq("id", id)
        .select(
          "id, tenant_id, name, phone, email, whatsapp_opt_in, active, created_at",
        )
        .single();
      if (error) throw error;
      return customerRowSchema.parse(data);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: CUSTOMERS_KEY });
    },
  });
}
