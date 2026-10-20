import { useEffect, useMemo } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";

import type { ScheduleValidityInput } from "@/lib/validations/schedule";
import {
  useScheduleValidity,
  useUpdateScheduleValidity,
} from "@/hooks/useProfessionals";

/** Data `YYYY-MM-DD` ou string vazia (campo opcional da UI). */
const optionalDate = z.union([
  z.literal(""),
  z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida (use AAAA-MM-DD)."),
]);

/**
 * Schema do form (shape da UI). Espelha `scheduleValiditySchema` de domínio —
 * início ≤ fim e passo 5..240 — mas trabalha com strings/`hasEndDate` em vez de
 * `null`. A conversão para `ScheduleValidityInput` acontece no submit.
 */
const validityFormSchema = z
  .object({
    scheduleStartDate: optionalDate,
    hasEndDate: z.boolean(),
    scheduleEndDate: optionalDate,
    slotStepMinutes: z
      .number({ invalid_type_error: "Informe o passo em minutos." })
      .int("O passo deve ser um número inteiro de minutos.")
      .min(5, "O passo deve ser de no mínimo 5 minutos.")
      .max(240, "O passo deve ser de no máximo 240 minutos."),
  })
  .superRefine((value, ctx) => {
    if (
      value.scheduleStartDate &&
      value.hasEndDate &&
      value.scheduleEndDate &&
      value.scheduleStartDate > value.scheduleEndDate
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "A data de início deve ser anterior ou igual à de fim.",
        path: ["scheduleEndDate"],
      });
    }
  });

type ValidityFormValues = z.infer<typeof validityFormSchema>;

interface ScheduleValidityFormProps {
  professionalId: string;
  /**
   * Vigência/passo é admin-only no MVP (ADR-01 / PRD §9 ponto 3). Em leitura
   * (professional/receptionist), os campos ficam desabilitados e sem botão de
   * salvar. A trava real é o RLS; a UI é defesa em profundidade.
   */
  readOnly: boolean;
}

/** Normaliza o form (`""` vira `null`) para o input validado por zod. */
function toValidityInput(values: ValidityFormValues): ScheduleValidityInput {
  return {
    scheduleStartDate: values.scheduleStartDate || null,
    scheduleEndDate: values.hasEndDate ? values.scheduleEndDate || null : null,
    slotStepMinutes: values.slotStepMinutes,
  };
}

/**
 * Vigência da grade ("Atende a partir de" / "Atende até", fim opcional) e o
 * passo-base de oferta de slots (`slot_step_minutes`) de um profissional. Salva
 * via `useUpdateScheduleValidity` (ADR-04), que toca só as três colunas de
 * schedule em `professionals`. Mobile-first; mensagens pt-BR.
 */
export function ScheduleValidityForm({
  professionalId,
  readOnly,
}: ScheduleValidityFormProps) {
  const validityQuery = useScheduleValidity(professionalId);
  const updateValidity = useUpdateScheduleValidity();

  const defaults = useMemo<ValidityFormValues>(() => {
    const data = validityQuery.data;
    return {
      scheduleStartDate: data?.schedule_start_date ?? "",
      hasEndDate: !!data?.schedule_end_date,
      scheduleEndDate: data?.schedule_end_date ?? "",
      slotStepMinutes: data?.slot_step_minutes ?? 30,
    };
  }, [validityQuery.data]);

  const form = useForm<ValidityFormValues>({
    resolver: zodResolver(validityFormSchema),
    defaultValues: defaults,
  });

  // Sincroniza o form com o servidor ao (re)carregar.
  useEffect(() => {
    form.reset(defaults);
  }, [defaults, form]);

  const hasEndDate = form.watch("hasEndDate");

  async function onSubmit(values: ValidityFormValues) {
    try {
      await updateValidity.mutateAsync({
        id: professionalId,
        ...toValidityInput(values),
      });
      toast.success("Vigência salva.");
    } catch {
      toast.error("Não foi possível salvar a vigência. Tente novamente.");
    }
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" noValidate>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <FormField
            control={form.control}
            name="scheduleStartDate"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Atende a partir de</FormLabel>
                <FormControl>
                  <Input type="date" disabled={readOnly} {...field} />
                </FormControl>
                <FormDescription>Opcional. Vazio = sem data de início.</FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          {hasEndDate ? (
            <FormField
              control={form.control}
              name="scheduleEndDate"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Atende até</FormLabel>
                  <FormControl>
                    <Input type="date" disabled={readOnly} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          ) : null}
        </div>

        <FormField
          control={form.control}
          name="hasEndDate"
          render={({ field }) => (
            <FormItem className="flex items-center justify-between gap-3">
              <FormLabel className="font-normal text-muted-foreground">
                Sem data de término
              </FormLabel>
              <FormControl>
                <Switch
                  checked={!field.value}
                  onCheckedChange={(checked) => field.onChange(!checked)}
                  disabled={readOnly}
                  aria-label="Sem data de término"
                />
              </FormControl>
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="slotStepMinutes"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Passo dos horários (minutos)</FormLabel>
              <FormControl>
                <Input
                  type="number"
                  min={5}
                  max={240}
                  step={5}
                  inputMode="numeric"
                  disabled={readOnly}
                  value={Number.isFinite(field.value) ? field.value : ""}
                  onChange={(event) => {
                    const next = event.target.valueAsNumber;
                    field.onChange(Number.isNaN(next) ? undefined : next);
                  }}
                  onBlur={field.onBlur}
                  name={field.name}
                  ref={field.ref}
                />
              </FormControl>
              <FormDescription>
                Granularidade de oferta dos horários (5 a 240 min).
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        {!readOnly ? (
          <div className="flex justify-end">
            <Button type="submit" disabled={updateValidity.isPending}>
              {updateValidity.isPending ? (
                <>
                  <Loader2 className="animate-spin" aria-hidden="true" />
                  Salvando…
                </>
              ) : (
                "Salvar vigência"
              )}
            </Button>
          </div>
        ) : null}
      </form>
    </Form>
  );
}
