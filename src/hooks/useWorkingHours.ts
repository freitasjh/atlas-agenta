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

/** Mensagem pt-BR para erro de duplicidade (unique) ao salvar a grade. */
export const WORKING_HOURS_DUPLICATE_MESSAGE =
  "Já existe uma faixa para este dia. Ajuste a grade e salve novamente.";

/**
 * Mensagem pt-BR quando o rollback falha: a grade no servidor pode estar
 * vazia/parcial — o operador precisa do snapshot da semana prévia para
 * restaurar manualmente (nunca vira `23505` genérico).
 */
export const WORKING_HOURS_ROLLBACK_FAILED_MESSAGE =
  "A grade anterior não pôde ser restaurada. Guarde o snapshot da semana anterior e contate o suporte.";

function isDuplicateError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code: unknown }).code === "23505"
  );
}

type DraftLike = {
  weekday: number;
  start_time: string;
  end_time: string;
  break_start: string | null;
  break_end: string | null;
};

function draftsEqual(
  current: DraftLike[],
  drafts: DraftLike[],
): boolean {
  if (current.length !== drafts.length) return false;
  const normalize = (d: { weekday: number; start_time: string; end_time: string; break_start: string | null; break_end: string | null }) =>
    `${d.weekday}|${d.start_time.slice(0, 5)}|${d.end_time.slice(0, 5)}|${d.break_start?.slice(0, 5) ?? ""}|${d.break_end?.slice(0, 5) ?? ""}`;
  const a = current.map(normalize).sort();
  const b = drafts.map(normalize).sort();
  return a.every((value, index) => value === b[index]);
}

function workingHoursKey(professionalId: string) {
  return ["working-hours", professionalId] as const;
}

/**
 * Restaura o snapshot da grade anterior (rollback do save em round-trips
 * não-atômicos). Tenta até 2x (delete + insert por tentativa); cada erro é
 * checado e logado. Retorna `true` só quando a semana prévia voltou.
 */
async function restoreSnapshot(
  snapshot: WorkingHourDraft[],
  professionalId: string,
): Promise<boolean> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const { error: deleteError } = await supabase
      .from("working_hours")
      .delete()
      .eq("professional_id", professionalId);
    if (deleteError) {
      console.error(
        "[working-hours] rollback: delete falhou ao restaurar grade anterior",
        { professionalId, attempt },
      );
      continue;
    }
    if (snapshot.length === 0) return true;
    const { error: insertError } = await supabase
      .from("working_hours")
      .insert(
        snapshot.map((day) => ({
          professional_id: professionalId,
          weekday: day.weekday,
          start_time: day.start_time,
          end_time: day.end_time,
          break_start: day.break_start,
          break_end: day.break_end,
        })),
      );
    if (!insertError) return true;
    console.error(
      "[working-hours] rollback: insert falhou ao restaurar grade anterior",
      { professionalId, attempt },
    );
  }
  return false;
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
 *
 * Sem RPC atômico no MVP (ADR-02 futuro), a mutation é idempotente e com
 * rollback: retrato a grade atual antes do delete; se o insert falhar, tenta
 * restaurar o retrato (semana prévia) antes de rejeitar. `23505` vira
 * mensagem pt-BR. Retry com o mesmo payload é no-op quando já persistido
 * (cache local comparado via query cache).
 */
export function useSaveWorkingHours(professionalId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (days: WorkingHourDraft[]) => {
      // Retrato da grade no cache (idempotência client-side + rollback).
      const cached =
        queryClient.getQueryData<WorkingHour[]>(workingHoursKey(professionalId)) ??
        [];
      if (draftsEqual(cached, days)) return;

      const { data: previous, error: previousError } = await supabase
        .from("working_hours")
        .select(
          "weekday, start_time, end_time, break_start, break_end",
        )
        .eq("professional_id", professionalId);
      if (previousError) throw previousError;
      const snapshot: WorkingHourDraft[] = (previous ?? []).map((row) => ({
        weekday: row.weekday,
        start_time: row.start_time,
        end_time: row.end_time,
        break_start: row.break_start,
        break_end: row.break_end,
      }));
      if (draftsEqual(snapshot, days)) return;

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
        if (insertError) {
          // Rollback total com checagem de erro (C3): restaura a semana prévia
          // (até 2 tentativas); se a restauração falhar, rejeita com erro
          // explícito pedindo o snapshot — nunca finge que o rollback ok.
          const restored = await restoreSnapshot(
            snapshot,
            professionalId,
          );
          if (!restored) {
            console.error(
              "[working-hours] rollback falhou ao restaurar grade anterior",
              { professionalId },
            );
            throw new Error(WORKING_HOURS_ROLLBACK_FAILED_MESSAGE);
          }
          throw isDuplicateError(insertError)
            ? new Error(WORKING_HOURS_DUPLICATE_MESSAGE)
            : insertError;
        }
      }
    },
    // `onSettled` (não `onSuccess`): o save é delete + insert em round-trips
    // separados; se o insert falhar depois do delete, a grade no servidor fica
    // vazia. Revalidar também no erro recarrega a grade real e evita exibir
    // estado fantasma (ex.: o form ainda com as faixas que não persistiram).
    onSettled: () => {
      void queryClient.invalidateQueries({
        queryKey: workingHoursKey(professionalId),
      });
    },
  });
}
