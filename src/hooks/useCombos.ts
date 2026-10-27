import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";

import { supabase } from "@/lib/supabase";
import type { Combo } from "@/types/domain";
import type { ComboInput } from "@/lib/validations/catalog";
import {
  insertComboServices,
  setComboServices,
} from "@/hooks/useComboServices";

/**
 * Hooks de dados de `combos` (pacotes do salão — TanStack Query). Toda leitura
 * valida o shape de retorno com zod; nenhuma escrita envia `tenant_id` (o RLS o
 * deriva do JWT). Inativar é **soft-delete** (`active = false`), nunca DELETE
 * físico. Espelho de `useServices` (mesma classe de dado operacional).
 *
 * A escrita de um combo é transacional em dois passos no cliente (sem RPC nesta
 * fase): grava a linha de `combos` e, em seguida, sincroniza os vínculos N:N em
 * `combo_services`. O invariante "≥1 serviço" é garantido antes de submeter
 * (zod em `comboSchema`); aqui os hooks assumem a lista já validada.
 */

const comboRowSchema = z.object({
  id: z.string(),
  tenant_id: z.string(),
  name: z.string(),
  price_cents: z.number().int(),
  active: z.boolean(),
  created_at: z.string(),
});

const comboListSchema = z.array(comboRowSchema);

const COMBOS_KEY = ["combos"] as const;

/** Lista de pacotes do tenant, opcionalmente só os ativos. */
export function useCombos(options?: { activeOnly?: boolean }) {
  const activeOnly = options?.activeOnly ?? false;
  return useQuery<Combo[]>({
    queryKey: [...COMBOS_KEY, { activeOnly }],
    queryFn: async () => {
      let query = supabase
        .from("combos")
        .select("id, tenant_id, name, price_cents, active, created_at")
        .order("name", { ascending: true });
      if (activeOnly) query = query.eq("active", true);
      const { data, error } = await query;
      if (error) throw error;
      return comboListSchema.parse(data);
    },
  });
}

/**
 * Cria um pacote e, em seguida, insere seus vínculos N:N de serviços. Nunca
 * envia `tenant_id` (RLS deriva do JWT). A escrita é em dois passos: grava
 * `combos`, depois `combo_services` com o id recém-criado.
 */
export function useCreateCombo() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: ComboInput) => {
      const { data, error } = await supabase
        .from("combos")
        .insert({
          name: input.name,
          price_cents: input.priceCents,
          active: input.active,
        })
        .select("id, tenant_id, name, price_cents, active, created_at")
        .single();
      if (error) throw error;
      const combo = comboRowSchema.parse(data);
      await insertComboServices(combo.id, input.serviceIds);
      return combo;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: COMBOS_KEY });
    },
  });
}

/**
 * Atualiza um pacote (nome, preço, ativo) e sincroniza os vínculos de serviços
 * (diff insert/delete). Nunca envia `tenant_id`.
 */
export function useUpdateCombo() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...input }: ComboInput & { id: string }) => {
      const { data, error } = await supabase
        .from("combos")
        .update({
          name: input.name,
          price_cents: input.priceCents,
          active: input.active,
        })
        .eq("id", id)
        .select("id, tenant_id, name, price_cents, active, created_at")
        .single();
      if (error) throw error;
      const combo = comboRowSchema.parse(data);
      await setComboServices(id, input.serviceIds);
      return combo;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: COMBOS_KEY });
    },
  });
}

/** Soft-delete / reativação: alterna `active`. Nunca DELETE físico. */
export function useDeactivateCombo() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, active }: { id: string; active: boolean }) => {
      const { data, error } = await supabase
        .from("combos")
        .update({ active })
        .eq("id", id)
        .select("id, tenant_id, name, price_cents, active, created_at")
        .single();
      if (error) throw error;
      return comboRowSchema.parse(data);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: COMBOS_KEY });
    },
  });
}
