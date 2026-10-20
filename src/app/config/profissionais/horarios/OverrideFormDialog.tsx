import { useEffect, useMemo } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import {
  scheduleOverrideSchema,
  type ScheduleOverrideInput,
} from "@/lib/validations/schedule";
import { useUpsertScheduleOverride } from "@/hooks/useScheduleOverrides";
import type { ScheduleOverride } from "@/types/domain";

/** `time` do banco (`HH:MM:SS`) → `HH:MM` que a UI edita. */
function toHourMinute(value: string | null): string | undefined {
  if (!value) return undefined;
  return value.slice(0, 5);
}

/** Monta os valores do form a partir de uma exceção existente (ou vazia). */
function buildDefaults(override: ScheduleOverride | null): ScheduleOverrideInput {
  if (!override) {
    return {
      overrideDate: "",
      isClosed: true,
      startTime: undefined,
      endTime: undefined,
      hasBreak: false,
      breakStart: undefined,
      breakEnd: undefined,
      reason: "",
    };
  }
  const hasBreak = !!(override.break_start && override.break_end);
  return {
    overrideDate: override.override_date,
    isClosed: override.is_closed,
    startTime: toHourMinute(override.start_time),
    endTime: toHourMinute(override.end_time),
    hasBreak,
    breakStart: hasBreak ? toHourMinute(override.break_start) : undefined,
    breakEnd: hasBreak ? toHourMinute(override.break_end) : undefined,
    reason: override.reason ?? "",
  };
}

interface OverrideFormDialogProps {
  professionalId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Exceção a editar; `null` cria uma nova. */
  override: ScheduleOverride | null;
}

/**
 * Diálogo para criar/editar uma exceção por data: folga (`isClosed = true`, sem
 * janela) ou horário atípico (`isClosed = false`, janela + intervalo opcional,
 * mesma ergonomia de `DayRow`). Valida com `scheduleOverrideSchema` (ADR-03) e
 * salva via `useUpsertScheduleOverride` (ADR-04). Erro de data duplicada vem
 * traduzido do hook ("Já existe uma exceção para esta data.").
 */
export function OverrideFormDialog({
  professionalId,
  open,
  onOpenChange,
  override,
}: OverrideFormDialogProps) {
  const isEdit = !!override;
  const upsertOverride = useUpsertScheduleOverride(professionalId);

  const defaults = useMemo(() => buildDefaults(override), [override]);

  const form = useForm<ScheduleOverrideInput>({
    resolver: zodResolver(scheduleOverrideSchema),
    defaultValues: defaults,
  });

  // Ao (re)abrir, sincroniza com a exceção selecionada (ou limpa, ao criar).
  useEffect(() => {
    if (open) form.reset(defaults);
  }, [open, defaults, form]);

  const isClosed = form.watch("isClosed");
  const hasBreak = form.watch("hasBreak");

  async function onSubmit(values: ScheduleOverrideInput) {
    try {
      await upsertOverride.mutateAsync({ ...values, id: override?.id });
      toast.success("Exceção salva.");
      onOpenChange(false);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Não foi possível salvar a exceção. Tente novamente.";
      if (message === "Já existe uma exceção para esta data.") {
        form.setError("overrideDate", { message });
      }
      toast.error(message);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Editar exceção" : "Nova exceção"}</DialogTitle>
          <DialogDescription>
            Registre uma folga (dia sem atendimento) ou um horário atípico para
            uma data específica. Sobrepõe a grade semanal nesse dia.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(onSubmit)}
            className="space-y-5"
            noValidate
          >
            <FormField
              control={form.control}
              name="overrideDate"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Data</FormLabel>
                  <FormControl>
                    <Input type="date" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="isClosed"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Tipo</FormLabel>
                  <Select
                    value={field.value ? "folga" : "atipico"}
                    onValueChange={(value) => field.onChange(value === "folga")}
                  >
                    <FormControl>
                      <SelectTrigger aria-label="Tipo da exceção">
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="folga">Folga (sem atendimento)</SelectItem>
                      <SelectItem value="atipico">Horário atípico</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            {!isClosed ? (
              <div className="space-y-4">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <FormField
                    control={form.control}
                    name="startTime"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Início</FormLabel>
                        <FormControl>
                          <Input
                            type="time"
                            {...field}
                            value={field.value ?? ""}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="endTime"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Fim</FormLabel>
                        <FormControl>
                          <Input
                            type="time"
                            {...field}
                            value={field.value ?? ""}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <FormField
                  control={form.control}
                  name="hasBreak"
                  render={({ field }) => (
                    <FormItem className="flex items-center justify-between gap-3">
                      <FormLabel className="font-normal text-muted-foreground">
                        Intervalo (almoço/pausa)
                      </FormLabel>
                      <FormControl>
                        <Switch
                          checked={field.value}
                          onCheckedChange={field.onChange}
                          aria-label="Intervalo na exceção"
                        />
                      </FormControl>
                    </FormItem>
                  )}
                />

                {hasBreak ? (
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <FormField
                      control={form.control}
                      name="breakStart"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Início do intervalo</FormLabel>
                          <FormControl>
                            <Input
                              type="time"
                              {...field}
                              value={field.value ?? ""}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="breakEnd"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Fim do intervalo</FormLabel>
                          <FormControl>
                            <Input
                              type="time"
                              {...field}
                              value={field.value ?? ""}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                ) : null}
              </div>
            ) : null}

            <FormField
              control={form.control}
              name="reason"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Motivo (opcional)</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="Ex.: feriado, congresso…"
                      maxLength={200}
                      {...field}
                      value={field.value ?? ""}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={upsertOverride.isPending}
              >
                Cancelar
              </Button>
              <Button type="submit" disabled={upsertOverride.isPending}>
                {upsertOverride.isPending ? (
                  <>
                    <Loader2 className="animate-spin" aria-hidden="true" />
                    Salvando…
                  </>
                ) : (
                  "Salvar"
                )}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
