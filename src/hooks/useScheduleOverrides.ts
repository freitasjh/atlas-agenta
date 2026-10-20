import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";

import { supabase } from "@/lib/supabase";
import { mapSchedulingError } from "@/lib/scheduling-errors";
import type { ScheduleOverrideInput } from "@/lib/validations/schedule";
import type { ScheduleOverride } from "@/types/domain";

/**
 * Exceções por data de um profissional (`schedule_overrides`, ADR-02) via
 * TanStack Query. Leitura validada por zod; nenhuma escrita envia `tenant_id`
 * (o RLS o deriva do JWT) — `professional_id` vai no corpo, e a FK composta +
 * RLS garantem que ele é do tenant do usuário. A trava de RBAC (admin / próprio
 * professional) é do banco; o hook só traduz o erro para pt-BR.
 *
 * Datas em `date` (`YYYY-MM-DD`, dia no fuso do tenant), horas em `time`
 * (`HH:MM`). `is_closed = true` → folga sem janela; `is_closed = false` →
 * janela atípica. A conversão para instante UTC acontece só na geração de slots
 * (ADR-05), não aqui.
 */

const scheduleOverrideRowSchema = z.object({
  id: z.string(),
  tenant_id: z.string(),
  professional_id: z.string(),
  override_date: z.string(),
  is_closed: z.boolean(),
  start_time: z.string().nullable(),
  end_time: z.string().nullable(),
  break_start: z.string().nullable(),
  break_end: z.string().nullable(),
  reason: z.string().nullable(),
  created_at: z.string(),
});

const scheduleOverrideListSchema = z.array(scheduleOverrideRowSchema);

const OVERRIDE_SELECT =
  "id, tenant_id, professional_id, override_date, is_closed, start_time, end_time, break_start, break_end, reason, created_at";

function scheduleOverridesKey(professionalId: string) {
  return ["schedule-overrides", professionalId] as const;
}

/**
 * Converte o input da tela (`hasBreak` + horas opcionais) nas colunas do banco.
 * Fechado não tem janela (tudo `null`); aberto grava a janela e o intervalo
 * ambos-ou-nenhum. `reason` vazio vira `null`.
 */
function toRow(input: ScheduleOverrideInput) {
  if (input.isClosed) {
    return {
      override_date: input.overrideDate,
      is_closed: true,
      start_time: null,
      end_time: null,
      break_start: null,
      break_end: null,
      reason: input.reason?.trim() ? input.reason.trim() : null,
    };
  }
  return {
    override_date: input.overrideDate,
    is_closed: false,
    start_time: input.startTime ?? null,
    end_time: input.endTime ?? null,
    break_start: input.hasBreak ? (input.breakStart ?? null) : null,
    break_end: input.hasBreak ? (input.breakEnd ?? null) : null,
    reason: input.reason?.trim() ? input.reason.trim() : null,
  };
}

/**
 * Traduz o erro de violação do `unique (tenant_id, professional_id,
 * override_date)` para a mensagem pt-BR específica; demais erros caem no
 * mapeamento genérico de agendamento.
 */
function mapOverrideError(error: unknown): string {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code: unknown }).code === "23505"
  ) {
    return "Já existe uma exceção para esta data.";
  }
  return mapSchedulingError(error);
}

export function useScheduleOverrides(professionalId: string | null) {
  return useQuery<ScheduleOverride[]>({
    queryKey: scheduleOverridesKey(professionalId ?? "none"),
    enabled: !!professionalId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("schedule_overrides")
        .select(OVERRIDE_SELECT)
        .eq("professional_id", professionalId as string)
        .order("override_date", { ascending: true });
      if (error) throw error;
      return scheduleOverrideListSchema.parse(data);
    },
  });
}

/**
 * Cria ou edita uma exceção. Sem `id` → insert; com `id` → update. Nenhum
 * `tenant_id` no corpo. Em erro de `unique`, a mutation rejeita com a mensagem
 * pt-BR traduzida (a tela exibe `error.message`).
 */
export function useUpsertScheduleOverride(professionalId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (
      input: ScheduleOverrideInput & { id?: string },
    ): Promise<ScheduleOverride> => {
      const row = toRow(input);
      const query = input.id
        ? supabase
            .from("schedule_overrides")
            .update(row)
            .eq("id", input.id)
        : supabase
            .from("schedule_overrides")
            .insert({ ...row, professional_id: professionalId });
      const { data, error } = await query.select(OVERRIDE_SELECT).single();
      if (error) throw new Error(mapOverrideError(error));
      return scheduleOverrideRowSchema.parse(data);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: scheduleOverridesKey(professionalId),
      });
    },
  });
}

/** Remove uma exceção pelo `id`. Sem `tenant_id`; o RLS isola. */
export function useDeleteScheduleOverride(professionalId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("schedule_overrides")
        .delete()
        .eq("id", id);
      if (error) throw new Error(mapSchedulingError(error));
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: scheduleOverridesKey(professionalId),
      });
    },
  });
}
