import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";

import { supabase } from "@/lib/supabase";
import type { Service } from "@/types/domain";
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
  price_cents: z.number().int(),
  active: z.boolean(),
  created_at: z.string(),
});

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
        .select("id, tenant_id, name, duration_minutes, price_cents, active, created_at")
        .order("name", { ascending: true });
      if (activeOnly) query = query.eq("active", true);
      const { data, error } = await query;
      if (error) throw error;
      return serviceListSchema.parse(data);
    },
  });
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
          price_cents: input.priceCents,
          active: input.active,
        })
        .select("id, tenant_id, name, duration_minutes, price_cents, active, created_at")
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
          price_cents: input.priceCents,
          active: input.active,
        })
        .eq("id", id)
        .select("id, tenant_id, name, duration_minutes, price_cents, active, created_at")
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
        .select("id, tenant_id, name, duration_minutes, price_cents, active, created_at")
        .single();
      if (error) throw error;
      return serviceRowSchema.parse(data);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: SERVICES_KEY });
    },
  });
}
