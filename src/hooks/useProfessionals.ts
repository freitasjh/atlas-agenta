import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";

import { supabase } from "@/lib/supabase";
import type { Professional } from "@/types/domain";
import type { ProfessionalInput } from "@/lib/validations/catalog";
import type { ScheduleValidityInput } from "@/lib/validations/schedule";

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

export function useProfessionals<TData = Professional[]>(options?: {
  activeOnly?: boolean;
  select?: (professionals: Professional[]) => TData;
}) {
  const activeOnly = options?.activeOnly ?? false;
  return useQuery<Professional[], Error, TData>({
    queryKey: [...PROFESSIONALS_KEY, { activeOnly }],
    select: options?.select,
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

/**
 * Vigência da grade + passo-base de slots de um profissional. Seletor fino
 * derivado de `useProfessionals` (os campos já vêm no `select`) para evitar um
 * request duplicado — a chave de query e o cache são compartilhados. Retorna
 * `null` enquanto a lista carrega ou quando o profissional não existe/é de outro
 * tenant (RLS não o traz).
 */
export interface ScheduleValidity {
  schedule_start_date: string | null;
  schedule_end_date: string | null;
  slot_step_minutes: number;
}

export function useScheduleValidity(professionalId: string | null) {
  return useProfessionals({
    select: (professionals): ScheduleValidity | null => {
      if (!professionalId) return null;
      const match = professionals.find((p) => p.id === professionalId);
      if (!match) return null;
      return {
        schedule_start_date: match.schedule_start_date,
        schedule_end_date: match.schedule_end_date,
        slot_step_minutes: match.slot_step_minutes,
      };
    },
  });
}

/**
 * Atualiza **apenas** as colunas de agenda em `professionals`
 * (`schedule_start_date`/`schedule_end_date`/`slot_step_minutes`) — não toca
 * `name`/`active`/`profile_id`. Sem `tenant_id` no corpo; o RLS garante que a
 * escrita é admin-only (ADR-01). Invalida a chave de profissionais.
 */
export function useUpdateScheduleValidity() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      ...input
    }: ScheduleValidityInput & { id: string }) => {
      const { data, error } = await supabase
        .from("professionals")
        .update({
          schedule_start_date: input.scheduleStartDate,
          schedule_end_date: input.scheduleEndDate,
          slot_step_minutes: input.slotStepMinutes,
        })
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
