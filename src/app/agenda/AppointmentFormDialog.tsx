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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import {
  appointmentSchema,
  type AppointmentInput,
} from "@/lib/validations/scheduling";
import {
  addMinutes,
  formatTimeInTenantTz,
  tenantDateTimeToUtc,
  toTenantLocal,
} from "@/lib/datetime";
import { formatCentsToBRL } from "@/lib/money";
import {
  mapSchedulingError,
  useCreateAppointment,
  useUpdateAppointment,
} from "@/hooks/useAppointments";
import { useAvailableSlots } from "@/hooks/useAvailableSlots";
import { useCustomers } from "@/hooks/useCustomers";
import { usePermissions } from "@/hooks/usePermissions";
import { useSegmentTerms } from "@/hooks/useSegmentTerms";
import { useProfessionals, useScheduleValidity } from "@/hooks/useProfessionals";
import { useScheduleOverrides } from "@/hooks/useScheduleOverrides";
import { useServices } from "@/hooks/useServices";
import { useWorkingHours } from "@/hooks/useWorkingHours";
import { SlotPicker, type SlotEmptyReason } from "@/app/agenda/SlotPicker";
import type { AppointmentWithRelations } from "@/types/domain";

/** Weekday (0=domingo) de um dia `YYYY-MM-DD`, independente do fuso local. */
function weekdayOf(day: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!match) return -1;
  return new Date(
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])),
  ).getUTCDay();
}

/** `true` se `day` está dentro de `[start, end]` (comparação lexical de datas). */
function isWithinValidity(
  day: string,
  start: string | null,
  end: string | null,
): boolean {
  if (start && day < start) return false;
  if (end && day > end) return false;
  return true;
}

interface AppointmentFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Agendamento a editar; `null`/ausente cria um novo. */
  appointment?: AppointmentWithRelations | null;
  /** Dia selecionado na agenda (`YYYY-MM-DD`), default da data ao criar. */
  day: string;
  /** Fuso do tenant (conversão na borda). */
  timeZone: string;
  /** Quando `professional`: id do próprio profissional (seletor travado nele). */
  lockedProfessionalId: string | null;
  /** Agendamentos já carregados do dia (checagem de conflito local). */
  dayAppointments: AppointmentWithRelations[];
  /**
   * Pré-preenchimento ao criar a partir de uma faixa vazia do calendário
   * (ADR-08): profissional e/ou início (`HH:MM`). Ignorado em edição. Só tem
   * efeito no (re)abrir.
   */
  prefill?: { professionalId?: string; time?: string } | null;
}

/**
 * Diálogo de criar/editar agendamento. Deriva `ends_at` (início +
 * `duration_minutes`) e `price_cents` (snapshot do serviço) no ato — exibidos
 * como texto auxiliar read-only, nunca editáveis aqui. Converte a hora local do
 * tenant → UTC na borda (helpers de ADR-05).
 *
 * A checagem de conflito local (contra o cache do dia) é feedback imediato
 * pt-BR; a trava real é a constraint de exclusão no banco (`23P01` →
 * `mapSchedulingError` → mesma mensagem).
 */
export function AppointmentFormDialog({
  open,
  onOpenChange,
  appointment,
  day,
  timeZone,
  lockedProfessionalId,
  dayAppointments,
  prefill,
}: AppointmentFormDialogProps) {
  const isEdit = !!appointment;

  const { canEditAnySchedule, canEditOwnSchedule } = usePermissions();
  const {
    servicoLabelSingular,
    profissionalLabelSingular,
    clienteLabel,
  } = useSegmentTerms();
  const servicoLower = servicoLabelSingular.toLowerCase();
  const profissionalLower = profissionalLabelSingular.toLowerCase();
  const clienteLower = clienteLabel.toLowerCase();

  const customersQuery = useCustomers({ activeOnly: true });
  const professionalsQuery = useProfessionals({ activeOnly: true });
  const servicesQuery = useServices({ activeOnly: true });

  const createAppointment = useCreateAppointment();
  const updateAppointment = useUpdateAppointment();

  const emptyValues: AppointmentInput = useMemo(
    () => ({
      customerId: "",
      professionalId: lockedProfessionalId ?? prefill?.professionalId ?? "",
      serviceId: "",
      date: day,
      time: prefill?.time ?? "",
    }),
    [day, lockedProfessionalId, prefill?.professionalId, prefill?.time],
  );

  const form = useForm<AppointmentInput>({
    resolver: zodResolver(appointmentSchema),
    defaultValues: emptyValues,
  });

  // Ao (re)abrir, sincroniza o form com o agendamento selecionado ou com os
  // valores novos (data = dia selecionado; profissional travado, se houver).
  useEffect(() => {
    if (!open) return;
    if (appointment) {
      const local = toTenantLocal(appointment.starts_at, timeZone);
      form.reset({
        customerId: appointment.customer_id,
        professionalId: appointment.professional_id,
        // `service_id` é nullable (XOR com `combo_id`, ADR-03); hoje só existem
        // agendamentos de serviço, então o `?? ""` preserva o sentinela vazio
        // do form. O modo "pacote" entra na ADR-06.
        serviceId: appointment.service_id ?? "",
        date: `${local.year.toString().padStart(4, "0")}-${local.month
          .toString()
          .padStart(2, "0")}-${local.day.toString().padStart(2, "0")}`,
        time: `${local.hour.toString().padStart(2, "0")}:${local.minute
          .toString()
          .padStart(2, "0")}`,
      });
    } else {
      form.reset(emptyValues);
    }
  }, [open, appointment, timeZone, emptyValues, form]);

  const watchedServiceId = form.watch("serviceId");
  const watchedProfessionalId = form.watch("professionalId");
  const watchedDate = form.watch("date");
  const watchedTime = form.watch("time");

  const selectedService = useMemo(
    () => servicesQuery.data?.find((s) => s.id === watchedServiceId) ?? null,
    [servicesQuery.data, watchedServiceId],
  );

  // Derivações read-only exibidas assim que serviço + data + hora estão prontos.
  const derived = useMemo(() => {
    if (!selectedService) return null;
    const startUtc = tenantDateTimeToUtc(watchedDate, watchedTime, timeZone);
    if (!startUtc) return null;
    const endUtc = addMinutes(startUtc, selectedService.duration_minutes);
    return {
      startUtc,
      endUtc,
      priceCents: selectedService.price_cents,
      endLabel: formatTimeInTenantTz(endUtc, timeZone),
    };
  }, [selectedService, watchedDate, watchedTime, timeZone]);

  // Slots livres sob demanda (ADR-05): dependem de profissional + serviço +
  // data já escolhidos. Em edição, exclui o próprio agendamento do desconto de
  // ocupados (o horário que ele ocupa continua ofertável).
  const {
    slots,
    isLoading: slotsLoading,
    isEnabled: slotsEnabled,
  } = useAvailableSlots({
    day: watchedDate,
    professionalId: watchedProfessionalId || null,
    serviceId: watchedServiceId || null,
    excludeAppointmentId: appointment?.id,
  });

  // Insumos da cascata (grade/exceção/vigência) — mesma chave de cache que o
  // hook de slots já lê, sem request novo. Usados só para escolher a MENSAGEM
  // do estado vazio (folga / fora-vigência / sem-grade / sem-slots); a trava e a
  // geração continuam em `useAvailableSlots`.
  const activeProfessionalId = watchedProfessionalId || null;
  const workingHoursQuery = useWorkingHours(activeProfessionalId);
  const overridesQuery = useScheduleOverrides(activeProfessionalId);
  const validityQuery = useScheduleValidity(activeProfessionalId);

  const emptyReason = useMemo<SlotEmptyReason | null>(() => {
    if (!slotsEnabled || slotsLoading || slots.length > 0) return null;

    const validity = validityQuery.data ?? null;
    if (
      !isWithinValidity(
        watchedDate,
        validity?.schedule_start_date ?? null,
        validity?.schedule_end_date ?? null,
      )
    ) {
      return "fora-vigencia";
    }

    const override =
      (overridesQuery.data ?? []).find((o) => o.override_date === watchedDate) ??
      null;
    if (override) {
      // Folga (fechado) ou janela atípica sem horário útil ainda é "sem slots".
      return override.is_closed ? "folga" : "sem-slots";
    }

    const weekday = weekdayOf(watchedDate);
    const hasGrade = (workingHoursQuery.data ?? []).some(
      (wh) => wh.weekday === weekday,
    );
    return hasGrade ? "sem-slots" : "sem-grade";
  }, [
    slotsEnabled,
    slotsLoading,
    slots.length,
    validityQuery.data,
    overridesQuery.data,
    workingHoursQuery.data,
    watchedDate,
  ]);

  // Link "Configurar horários" no estado sem-grade, só para quem pode editar a
  // grade (admin qualquer uma; professional a própria). Defesa em profundidade;
  // a trava real é o RLS.
  const canConfigureSchedule =
    canEditAnySchedule ||
    (canEditOwnSchedule && activeProfessionalId === lockedProfessionalId);
  const configureScheduleHref =
    canConfigureSchedule && activeProfessionalId
      ? `/app/config/profissionais/${activeProfessionalId}/horarios`
      : undefined;

  const isSaving = createAppointment.isPending || updateAppointment.isPending;

  const customers = customersQuery.data ?? [];
  const services = servicesQuery.data ?? [];

  // Profissionais ofertados: travado no próprio quando `professional`.
  const professionals = useMemo(() => {
    const all = professionalsQuery.data ?? [];
    if (lockedProfessionalId) {
      return all.filter((p) => p.id === lockedProfessionalId);
    }
    return all;
  }, [professionalsQuery.data, lockedProfessionalId]);

  /**
   * Conflito local: `[startUtc, endUtc)` sobrepõe um agendamento ativo do mesmo
   * profissional no dia (ignora `cancelado`/`nao_compareceu` e o próprio, em
   * edição). Espelha a constraint de exclusão parcial do banco.
   */
  function hasLocalConflict(startUtc: Date, endUtc: Date): boolean {
    const startMs = startUtc.getTime();
    const endMs = endUtc.getTime();
    return dayAppointments.some((item) => {
      if (appointment && item.id === appointment.id) return false;
      if (item.professional_id !== watchedProfessionalId) return false;
      if (item.status === "cancelado" || item.status === "nao_compareceu") {
        return false;
      }
      const itemStart = new Date(item.starts_at).getTime();
      const itemEnd = new Date(item.ends_at).getTime();
      // Sobreposição de intervalos semiabertos [início, fim).
      return startMs < itemEnd && itemStart < endMs;
    });
  }

  async function onSubmit(values: AppointmentInput) {
    const service = services.find((s) => s.id === values.serviceId);
    if (!service) {
      form.setError("serviceId", {
        message: `Selecione um ${servicoLower}.`,
      });
      return;
    }

    const startUtc = tenantDateTimeToUtc(values.date, values.time, timeZone);
    if (!startUtc) {
      form.setError("time", { message: "Informe um horário válido (HH:MM)." });
      return;
    }
    const endUtc = addMinutes(startUtc, service.duration_minutes);

    if (hasLocalConflict(startUtc, endUtc)) {
      form.setError("time", {
        message: "Este profissional já tem um agendamento neste horário.",
      });
      return;
    }

    const payload = {
      customerId: values.customerId,
      professionalId: values.professionalId,
      serviceId: values.serviceId,
      startsAt: startUtc.toISOString(),
      endsAt: endUtc.toISOString(),
      priceCents: service.price_cents,
    };

    try {
      if (appointment) {
        await updateAppointment.mutateAsync({ id: appointment.id, ...payload });
        toast.success("Agendamento atualizado.");
      } else {
        await createAppointment.mutateAsync(payload);
        toast.success("Agendamento criado.");
      }
      // GANCHO (fase WhatsApp): disparar confirmação/lembrete ao cliente.
      onOpenChange(false);
    } catch (error) {
      const message = mapSchedulingError(error);
      // Conflito que escapou da checagem local (corrida) cai inline no horário.
      if (message === "Este profissional já tem um agendamento neste horário.") {
        form.setError("time", { message });
      }
      toast.error(message);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? "Editar agendamento" : "Novo agendamento"}
          </DialogTitle>
          <DialogDescription>
            {`Escolha ${clienteLower}, ${profissionalLower}, ${servicoLower} e horário. O término e o valor são calculados pelo ${servicoLower}.`}
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
              name="customerId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{clienteLabel}</FormLabel>
                  <Select
                    value={field.value || undefined}
                    onValueChange={field.onChange}
                  >
                    <FormControl>
                      <SelectTrigger aria-label={clienteLabel}>
                        <SelectValue placeholder={`Selecione o ${clienteLower}`} />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {customers.map((customer) => (
                        <SelectItem key={customer.id} value={customer.id}>
                          {customer.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="professionalId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{profissionalLabelSingular}</FormLabel>
                  <Select
                    value={field.value || undefined}
                    onValueChange={field.onChange}
                    disabled={!!lockedProfessionalId}
                  >
                    <FormControl>
                      <SelectTrigger aria-label={profissionalLabelSingular}>
                        <SelectValue
                          placeholder={`Selecione o ${profissionalLower}`}
                        />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {professionals.map((professional) => (
                        <SelectItem
                          key={professional.id}
                          value={professional.id}
                        >
                          {professional.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="serviceId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{servicoLabelSingular}</FormLabel>
                  <Select
                    value={field.value || undefined}
                    onValueChange={field.onChange}
                  >
                    <FormControl>
                      <SelectTrigger aria-label={servicoLabelSingular}>
                        <SelectValue placeholder={`Selecione o ${servicoLower}`} />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {services.map((service) => (
                        <SelectItem key={service.id} value={service.id}>
                          {service.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="date"
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
              name="time"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Hora de início</FormLabel>
                  <FormControl>
                    <SlotPicker
                      slots={slots}
                      isLoading={slotsLoading}
                      isEnabled={slotsEnabled}
                      emptyReason={emptyReason}
                      value={field.value}
                      onSelect={(time) =>
                        form.setValue("time", time, {
                          shouldValidate: true,
                          shouldDirty: true,
                        })
                      }
                      configureScheduleHref={configureScheduleHref}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Derivados read-only (término previsto + valor do serviço). */}
            {derived ? (
              <div className="rounded-md border border-border bg-muted/30 p-3 text-sm">
                <p className="text-muted-foreground">
                  Término previsto:{" "}
                  <span className="font-medium tabular-nums text-foreground">
                    {derived.endLabel}
                  </span>
                </p>
                <p className="text-muted-foreground">
                  Valor:{" "}
                  <span className="font-medium tabular-nums text-foreground">
                    {formatCentsToBRL(derived.priceCents)}
                  </span>
                </p>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                {`Escolha o ${servicoLower} e o horário para ver o término e o valor.`}
              </p>
            )}

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={isSaving}
              >
                Cancelar
              </Button>
              <Button type="submit" disabled={isSaving}>
                {isSaving ? (
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
