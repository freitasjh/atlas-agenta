import { useEffect, useMemo } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Form } from "@/components/ui/form";

import {
  weeklyScheduleSchema,
  type WeeklyScheduleInput,
} from "@/lib/validations/catalog";
import {
  useSaveWorkingHours,
  type WorkingHourDraft,
} from "@/hooks/useWorkingHours";
import { WEEKDAYS, type WorkingHour } from "@/types/domain";

import { DayRow } from "@/app/config/profissionais/horarios/DayRow";

/**
 * Ordem de exibição da grade: segunda→domingo (design em analysis-frontend.md).
 * Os índices referenciam posições em `WEEKDAYS` (0=domingo…6=sábado), que
 * permanece a ordem do array `days` do form e do valor persistido em
 * `working_hours.weekday`. Aqui só reordenamos a renderização.
 */
const DISPLAY_ORDER = [1, 2, 3, 4, 5, 6, 0] as const;

interface WeekScheduleFormProps {
  professionalId: string;
  /** Linhas atuais da grade (lidas sob RLS). */
  workingHours: WorkingHour[];
  /** Leitura (grade de outro profissional / recepção): sem salvar. */
  readOnly: boolean;
}

/** `time` do banco vem como `HH:MM:SS`; a UI edita `HH:MM`. */
function toHourMinute(value: string | null): string | undefined {
  if (!value) return undefined;
  return value.slice(0, 5);
}

/** Monta o form de 7 dias a partir das linhas persistidas (uma faixa por dia). */
function buildDefaults(workingHours: WorkingHour[]): WeeklyScheduleInput {
  const byWeekday = new Map<number, WorkingHour>();
  for (const row of workingHours) {
    // A UI é a superfície estreita: uma faixa por dia. Se o banco (permissivo)
    // tiver mais de uma linha no mesmo dia, mostramos a primeira por weekday.
    if (!byWeekday.has(row.weekday)) byWeekday.set(row.weekday, row);
  }

  return {
    days: WEEKDAYS.map(({ value }) => {
      const row = byWeekday.get(value);
      const hasBreak = !!(row?.break_start && row?.break_end);
      return {
        weekday: value,
        enabled: !!row,
        startTime: toHourMinute(row?.start_time ?? null),
        endTime: toHourMinute(row?.end_time ?? null),
        hasBreak,
        breakStart: hasBreak ? toHourMinute(row?.break_start ?? null) : undefined,
        breakEnd: hasBreak ? toHourMinute(row?.break_end ?? null) : undefined,
      };
    }),
  };
}

/** Converte os dias habilitados do form nas faixas a persistir. */
function toDrafts(values: WeeklyScheduleInput): WorkingHourDraft[] {
  return values.days
    .filter((day) => day.enabled && day.startTime && day.endTime)
    .map((day) => ({
      weekday: day.weekday,
      start_time: day.startTime as string,
      end_time: day.endTime as string,
      break_start: day.hasBreak ? (day.breakStart as string) : null,
      break_end: day.hasBreak ? (day.breakEnd as string) : null,
    }));
}

/**
 * Form da grade semanal: 7 linhas (`DayRow`), validadas pelo
 * `weeklyScheduleSchema` antes do submit. "Salvar grade" persiste a grade
 * inteira num único mutation (`useSaveWorkingHours`): replace das linhas do
 * profissional, nunca 7 submits. Ao recarregar, a grade volta consistente.
 *
 * Em modo leitura não há botão de salvar; os campos ficam desabilitados.
 */
export function WeekScheduleForm({
  professionalId,
  workingHours,
  readOnly,
}: WeekScheduleFormProps) {
  const saveWorkingHours = useSaveWorkingHours(professionalId);

  const defaults = useMemo(
    () => buildDefaults(workingHours),
    [workingHours],
  );

  const form = useForm<WeeklyScheduleInput>({
    resolver: zodResolver(weeklyScheduleSchema),
    defaultValues: defaults,
  });

  // Quando os dados (re)carregam, sincroniza o form com a grade do servidor.
  useEffect(() => {
    form.reset(defaults);
  }, [defaults, form]);

  async function onSubmit(values: WeeklyScheduleInput) {
    try {
      await saveWorkingHours.mutateAsync(toDrafts(values));
      toast.success("Grade de horários salva.");
    } catch {
      toast.error("Não foi possível salvar a grade. Tente novamente.");
    }
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" noValidate>
        <div className="space-y-3">
          {DISPLAY_ORDER.map((weekdayIndex) => {
            const weekday = WEEKDAYS[weekdayIndex];
            return (
              <DayRow
                key={weekday.value}
                index={weekdayIndex}
                label={weekday.label}
                readOnly={readOnly}
              />
            );
          })}
        </div>

        {!readOnly ? (
          <div className="flex justify-end">
            <Button type="submit" disabled={saveWorkingHours.isPending}>
              {saveWorkingHours.isPending ? (
                <>
                  <Loader2 className="animate-spin" aria-hidden="true" />
                  Salvando…
                </>
              ) : (
                "Salvar grade"
              )}
            </Button>
          </div>
        ) : null}
      </form>
    </Form>
  );
}
