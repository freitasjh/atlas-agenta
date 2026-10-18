import { useFormContext } from "react-hook-form";

import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";

import type { WeeklyScheduleInput } from "@/lib/validations/catalog";

interface DayRowProps {
  /** Índice do dia dentro do array `days` (0–6, mesma ordem de `WEEKDAYS`). */
  index: number;
  /** Rótulo pt-BR do dia (ex.: "Segunda-feira"). */
  label: string;
  /** Leitura (grade de outro profissional / recepção): sem edição. */
  readOnly: boolean;
}

/**
 * Uma linha da grade semanal: liga/desliga o dia e, quando ligado, edita a
 * janela de expediente e um intervalo opcional. A validação (`start ≥ end`,
 * intervalo incoerente/fora da janela) vive no `weeklyScheduleSchema` e barra o
 * submit com mensagem pt-BR — aqui só renderizamos os campos e os erros.
 *
 * Em modo leitura, o switch e os inputs ficam desabilitados (sem botão de
 * salvar na tela); a trava real de escrita é o RLS no banco.
 */
export function DayRow({ index, label, readOnly }: DayRowProps) {
  const form = useFormContext<WeeklyScheduleInput>();
  const enabled = form.watch(`days.${index}.enabled`);
  const hasBreak = form.watch(`days.${index}.hasBreak`);

  return (
    <div className="rounded-lg border border-border p-4">
      <FormField
        control={form.control}
        name={`days.${index}.enabled`}
        render={({ field }) => (
          <FormItem className="flex items-center justify-between gap-3">
            <FormLabel className="text-base font-medium">{label}</FormLabel>
            <FormControl>
              <Switch
                checked={field.value}
                onCheckedChange={field.onChange}
                disabled={readOnly}
                aria-label={
                  field.value
                    ? `Desativar atendimento em ${label}`
                    : `Ativar atendimento em ${label}`
                }
              />
            </FormControl>
          </FormItem>
        )}
      />

      {enabled ? (
        <div className="mt-4 space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <FormField
              control={form.control}
              name={`days.${index}.startTime`}
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Início</FormLabel>
                  <FormControl>
                    <Input
                      type="time"
                      disabled={readOnly}
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
              name={`days.${index}.endTime`}
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Fim</FormLabel>
                  <FormControl>
                    <Input
                      type="time"
                      disabled={readOnly}
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
            name={`days.${index}.hasBreak`}
            render={({ field }) => (
              <FormItem className="flex items-center justify-between gap-3">
                <FormLabel className="font-normal text-muted-foreground">
                  Intervalo (almoço/pausa)
                </FormLabel>
                <FormControl>
                  <Switch
                    checked={field.value}
                    onCheckedChange={field.onChange}
                    disabled={readOnly}
                    aria-label={`Intervalo em ${label}`}
                  />
                </FormControl>
              </FormItem>
            )}
          />

          {hasBreak ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <FormField
                control={form.control}
                name={`days.${index}.breakStart`}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Início do intervalo</FormLabel>
                    <FormControl>
                      <Input
                        type="time"
                        disabled={readOnly}
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
                name={`days.${index}.breakEnd`}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Fim do intervalo</FormLabel>
                    <FormControl>
                      <Input
                        type="time"
                        disabled={readOnly}
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
    </div>
  );
}
