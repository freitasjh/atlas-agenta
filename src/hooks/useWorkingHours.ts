import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";

import { supabase } from "@/lib/supabase";
import type { WorkingHour } from "@/types/domain";

/**
 * Grade semanal (`working_hours`) de um profissional. Salvar é por profissional,
 * a **grade inteira** num único `useMutation` (D7): apaga as linhas atuais do
 * profissional e reinsere as faixas habilitadas, em vez de 7 submits soltos.
 * Nenhum `tenant_id` é enviado — o RLS o deriva do JWT.
 *
 * Horas são `time` (`HH:MM`), grade recorrente por dia — sem conversão de fuso
 * aqui (isso vale para `timestamptz` de appointments, fase futura).
 */

const workingHourRowSchema = z.object({
  id: z.string(),
  tenant_id: z.string(),
  professional_id: z.string(),
  weekday: z.number().int(),
  start_time: z.string(),
  end_time: z.string(),
  break_start: z.string().nullable(),
  break_end: z.string().nullable(),
  created_at: z.string(),
});

const workingHourListSchema = z.array(workingHourRowSchema);

/** Uma faixa a persistir (já validada pela tela). */
export interface WorkingHourDraft {
  weekday: number;
  start_time: string;
  end_time: string;
  break_start: string | null;
  break_end: string | null;
}

function workingHoursKey(professionalId: string) {
  return ["working-hours", professionalId] as const;
}

export function useWorkingHours(professionalId: string | null) {
  return useQuery<WorkingHour[]>({
    queryKey: workingHoursKey(professionalId ?? "none"),
    enabled: !!professionalId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("working_hours")
        .select(
          "id, tenant_id, professional_id, weekday, start_time, end_time, break_start, break_end, created_at",
        )
        .eq("professional_id", professionalId as string)
        .order("weekday", { ascending: true });
      if (error) throw error;
      return workingHourListSchema.parse(data);
    },
  });
}

/**
 * Salva a grade inteira do profissional: delete-all + reinsert das faixas
 * habilitadas. `professional_id` vai no corpo (não é `tenant_id`); o RLS e a FK
 * composta garantem que o profissional é do tenant do usuário.
 */
export function useSaveWorkingHours(professionalId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (days: WorkingHourDraft[]) => {
      const { error: deleteError } = await supabase
        .from("working_hours")
        .delete()
        .eq("professional_id", professionalId);
      if (deleteError) throw deleteError;

      if (days.length > 0) {
        const { error: insertError } = await supabase
          .from("working_hours")
          .insert(
            days.map((day) => ({
              professional_id: professionalId,
              weekday: day.weekday,
              start_time: day.start_time,
              end_time: day.end_time,
              break_start: day.break_start,
              break_end: day.break_end,
            })),
          );
        if (insertError) throw insertError;
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: workingHoursKey(professionalId),
      });
    },
  });
}
