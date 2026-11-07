import { useEffect, useMemo, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { AlertTriangle, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Form } from "@/components/ui/form";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import {
  weeklyScheduleSchema,
  type WeeklyScheduleInput,
} from "@/lib/validations/catalog";
import {
  useSaveWorkingHours,
  WORKING_HOURS_DUPLICATE_MESSAGE,
  type WorkingHourDraft,
} from "@/hooks/useWorkingHours";
import { useTenant } from "@/hooks/useTenant";
import { useAppointmentActivityRange } from "@/hooks/useAppointments";
import { todayInTimeZone } from "@/lib/datetime";
import {
  WEEKDAYS,
  type ScheduleOverride,
  type WorkingHour,
} from "@/types/domain";
import {
  findBatchConflicts,
  type BatchConflict,
} from "@/app/config/profissionais/horarios/deriveMonthlyGrade";
import {
  SCHEDULE_PRESETS,
  applyPreset,
  copyDayToTargets,
  countChangedDays,
} from "@/app/config/profissionais/horarios/schedulePresets";

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
  /** Exceções por data do profissional (cascata do check de conflito, A1). */
  overrides?: ScheduleOverride[];
  /** Leitura (grade de outro profissional / recepção): sem salvar. */
  readOnly: boolean;
  /** True quando a assinatura bloqueado/cancelado nega a escrita operacional. */
  writeBlockedBySubscription?: boolean;
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
 * Form da grade semanal em lote (FE-02): 7 linhas (`DayRow`) com presets
 * (ex.: Segunda a sexta 8h–18h), seleção de dias alvo e "copiar dia →
 * selecionados", fim de semana dedicado via preset, e rodapé sticky com o
 * diff "N dias alterados".
 *
 * Antes de salvar, checa `APPOINTMENT_CONFLICT_FUTURE`: todo appointment
 * ativo futuro do profissional precisa caber na grade nova; se conflitar,
 * bloqueia o save com `Alert` âmbar e mensagem pt-BR (nunca deleta/move o
 * agendamento). O save em si (`useSaveWorkingHours`) é idempotente com
 * rollback total nos round-trips não-atômicos e traduz `23505` para pt-BR.
 */
export function WeekScheduleForm({
  professionalId,
  workingHours,
  overrides = [],
  readOnly,
  writeBlockedBySubscription = false,
}: WeekScheduleFormProps) {
  const saveWorkingHours = useSaveWorkingHours(professionalId);
  const { data: tenant } = useTenant();
  const timeZone = tenant?.timezone ?? "America/Sao_Paulo";

  const defaults = useMemo(
    () => buildDefaults(workingHours),
    [workingHours],
  );

  const form = useForm<WeeklyScheduleInput>({
    resolver: zodResolver(weeklyScheduleSchema),
    defaultValues: defaults,
  });

  useEffect(() => {
    form.reset(defaults);
  }, [defaults, form]);

  // `useWatch` (A6): assina só o campo `days` (evita re-render a cada campo
  // do form) e a identidade do valor só muda quando `days` muda de fato.
  const watchedDays = useWatch({ control: form.control, name: "days" });
  const changedDays = useMemo(
    () => countChangedDays(defaults.days, watchedDays),
    [defaults, watchedDays],
  );

  const [copySource, setCopySource] = useState<number | null>(null);
  const [copyTargets, setCopyTargets] = useState<number[]>([]);
  const [conflicts, setConflicts] = useState<BatchConflict[]>([]);

  // Janela de checagem de conflito: hoje → +60 dias (appointment futuro
  // ativo que a grade nova precisa cobrir) — horizonte documentado em
  // `findBatchConflicts` (A1). "Hoje" no fuso do tenant (A6), nunca UTC.
  // Query escopada por profissional + faixa de dias — nunca o tenant inteiro
  // (SPEC §8 DoS) — e com colunas leves (sem join/PII).
  const tenantTimeZone = tenant?.timezone ?? null;
  const todayStr = useMemo(
    () => (tenantTimeZone ? todayInTimeZone(tenantTimeZone) : null),
    [tenantTimeZone],
  );
  const rangeEnd = useMemo(() => {
    if (!todayStr) return null;
    const d = new Date(`${todayStr}T00:00:00.000Z`);
    d.setUTCDate(d.getUTCDate() + 60);
    return d.toISOString().slice(0, 10);
  }, [todayStr]);
  const appointmentsQuery = useAppointmentActivityRange({
    startDay: todayStr ?? "",
    endDay: rangeEnd ?? "",
    professionalId,
    enabled: !readOnly && todayStr !== null && rangeEnd !== null,
  });

  function onApplyPreset(presetId: string) {
    const preset = SCHEDULE_PRESETS.find((p) => p.id === presetId);
    if (!preset) return;
    const current = form.getValues("days");
    form.reset({ days: applyPreset(current, preset) });
  }

  function onCopyToSelected() {
    if (copySource === null || copyTargets.length === 0) return;
    const current = form.getValues("days");
    form.reset({
      days: copyDayToTargets(current, copySource, copyTargets),
    });
  }

  async function onSubmit(values: WeeklyScheduleInput) {
    setConflicts([]);
    const drafts = toDrafts(values);
    // C2: o cache pode estar velho (query ainda em voo enquanto o usuário
    // edita). `refetch()` antes do check garante os appointments de agora;
    // em falha de refetch, `refetched.data` é `undefined` e cai para `[]`
    // (sem conflito falso) — o save segue protegido pelo rollback.
    const refetched = await appointmentsQuery.refetch();
    const appointments = (refetched.data ?? appointmentsQuery.data ?? []).map(
      (a) => ({
        id: a.id,
        startsAt: a.starts_at,
        endsAt: a.ends_at,
        status: a.status,
      }),
    );
    const found = findBatchConflicts({
      drafts,
      appointments,
      nowUtc: new Date(),
      timeZone,
      overrides,
    });
    if (found.length > 0) {
      setConflicts(found);
      toast.error(
        "A nova grade conflita com um agendamento futuro. Ajuste o horário antes de salvar.",
      );
      return;
    }
    try {
      await saveWorkingHours.mutateAsync(drafts);
      toast.success("Grade de horários salva.");
    } catch (error) {
      const message =
        error instanceof Error ? error.message : undefined;
      toast.error(
        message === WORKING_HOURS_DUPLICATE_MESSAGE
          ? message
          : "Não foi possível salvar a grade. Tente novamente.",
      );
    }
  }

  const blocked = readOnly || writeBlockedBySubscription;

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(onSubmit)}
        className="space-y-4"
        noValidate
      >
        {!blocked ? (
          <div className="space-y-3 rounded-lg border border-border p-4">
            <p className="text-sm font-medium">
              Preencher a semana inteira de uma vez
            </p>
            <div className="flex flex-wrap gap-2">
              {SCHEDULE_PRESETS.map((preset) => (
                <Button
                  key={preset.id}
                  type="button"
                  variant="outline"
                  size="sm"
                  className="min-h-[44px]"
                  onClick={() => onApplyPreset(preset.id)}
                >
                  {preset.label}
                </Button>
              ))}
            </div>
            <div className="flex flex-wrap items-end gap-3">
              <div className="space-y-1">
                <Label htmlFor="copy-source">Copiar dia</Label>
                <Select
                  value={copySource === null ? "" : String(copySource)}
                  onValueChange={(value) =>
                    setCopySource(value === "" ? null : Number(value))
                  }
                >
                  <SelectTrigger id="copy-source" className="min-w-[160px]">
                    <SelectValue placeholder="Escolha o dia de origem" />
                  </SelectTrigger>
                  <SelectContent>
                    {WEEKDAYS.map((day) => (
                      <SelectItem key={day.value} value={String(day.value)}>
                        {day.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <fieldset aria-label="Dias de destino da cópia">
                <legend className="text-sm font-medium">Para os dias</legend>
                <div className="flex flex-wrap gap-3">
                  {WEEKDAYS.map((day) => (
                    <span key={day.value} className="flex items-center gap-2">
                      <Checkbox
                        id={`copy-target-${day.value}`}
                        checked={copyTargets.includes(day.value)}
                        onCheckedChange={(checked) =>
                          setCopyTargets((prev) =>
                            checked === true
                              ? [...prev, day.value]
                              : prev.filter((v) => v !== day.value),
                          )
                        }
                      />
                      <Label htmlFor={`copy-target-${day.value}`}>
                        {day.label}
                      </Label>
                    </span>
                  ))}
                </div>
              </fieldset>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="min-h-[44px]"
                disabled={copySource === null || copyTargets.length === 0}
                onClick={onCopyToSelected}
              >
                Copiar para selecionados
              </Button>
            </div>
          </div>
        ) : null}

        <div className="space-y-3">
          {DISPLAY_ORDER.map((weekdayIndex) => {
            const weekday = WEEKDAYS[weekdayIndex];
            return (
              <DayRow
                key={weekday.value}
                index={weekdayIndex}
                label={weekday.label}
                readOnly={blocked}
              />
            );
          })}
        </div>

        {conflicts.length > 0 ? (
          <div
            role="alert"
            className="flex gap-2 rounded-md border border-amber-600/40 bg-amber-50 p-3 text-sm text-amber-900"
          >
            <AlertTriangle
              className="mt-0.5 h-4 w-4 shrink-0"
              aria-hidden="true"
            />
            <div>
              <p className="font-medium">
                Não foi possível salvar — conflito com agendamento futuro.
              </p>
              <p>
                {conflicts[0]?.message}{" "}
                {conflicts[0]?.date
                  ? `Dia ${conflicts[0].date}.`
                  : ""}
              </p>
            </div>
          </div>
        ) : null}

        {!blocked ? (
          <div className="sticky bottom-0 z-10 -mx-1 rounded-lg border border-border bg-background/95 px-4 py-3 shadow-sm backdrop-blur">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-muted-foreground tabular-nums" aria-live="polite">
                {changedDays === 0
                  ? "Nenhum dia alterado"
                  : `${changedDays} ${changedDays === 1 ? "dia alterado" : "dias alterados"}`}
              </p>
              <Button
                type="submit"
                disabled={
                  saveWorkingHours.isPending ||
                  appointmentsQuery.isFetching ||
                  changedDays === 0
                }
                className="min-h-[44px]"
              >
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
          </div>
        ) : null}
      </form>
    </Form>
  );
}
