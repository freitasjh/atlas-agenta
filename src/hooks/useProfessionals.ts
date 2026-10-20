import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";

import { supabase } from "@/lib/supabase";
import type { Professional } from "@/types/domain";
import type { ProfessionalInput } from "@/lib/validations/catalog";

/**
 * Hooks de dados de `professionals` (TanStack Query). Validação zod no retorno;
 * nenhuma escrita envia `tenant_id`. `profile_id` é somente-leitura nesta fase
 * (sem fluxo de convite) — a criação só grava o registro operacional. Inativar
 * é soft-delete (`active = false`), nunca DELETE físico.
 */

const professionalRowSchema = z.object({
  id: z.string(),
  tenant_id: z.string(),
  name: z.string(),
  profile_id: z.string().nullable(),
  active: z.boolean(),
  schedule_start_date: z.string().nullable(),
  schedule_end_date: z.string().nullable(),
  slot_step_minutes: z.number(),
  created_at: z.string(),
});

const professionalListSchema = z.array(professionalRowSchema);

const PROFESSIONALS_KEY = ["professionals"] as const;

export function useProfessionals(options?: { activeOnly?: boolean }) {
  const activeOnly = options?.activeOnly ?? false;
  return useQuery<Professional[]>({
    queryKey: [...PROFESSIONALS_KEY, { activeOnly }],
    queryFn: async () => {
      let query = supabase
        .from("professionals")
        .select(
          "id, tenant_id, name, profile_id, active, schedule_start_date, schedule_end_date, slot_step_minutes, created_at",
        )
        .order("name", { ascending: true });
      if (activeOnly) query = query.eq("active", true);
      const { data, error } = await query;
      if (error) throw error;
      return professionalListSchema.parse(data);
    },
  });
}

export function useCreateProfessional() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: ProfessionalInput) => {
      const { data, error } = await supabase
        .from("professionals")
        .insert({ name: input.name, active: input.active })
        .select(
          "id, tenant_id, name, profile_id, active, schedule_start_date, schedule_end_date, slot_step_minutes, created_at",
        )
        .single();
      if (error) throw error;
      return professionalRowSchema.parse(data);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: PROFESSIONALS_KEY });
    },
  });
}

export function useUpdateProfessional() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...input }: ProfessionalInput & { id: string }) => {
      const { data, error } = await supabase
        .from("professionals")
        .update({ name: input.name, active: input.active })
        .eq("id", id)
        .select(
          "id, tenant_id, name, profile_id, active, schedule_start_date, schedule_end_date, slot_step_minutes, created_at",
        )
        .single();
      if (error) throw error;
      return professionalRowSchema.parse(data);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: PROFESSIONALS_KEY });
    },
  });
}

/** Soft-delete / reativação: alterna `active`. Nunca DELETE físico. */
export function useDeactivateProfessional() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, active }: { id: string; active: boolean }) => {
      const { data, error } = await supabase
        .from("professionals")
        .update({ active })
        .eq("id", id)
        .select(
          "id, tenant_id, name, profile_id, active, schedule_start_date, schedule_end_date, slot_step_minutes, created_at",
        )
        .single();
      if (error) throw error;
      return professionalRowSchema.parse(data);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: PROFESSIONALS_KEY });
    },
  });
}
