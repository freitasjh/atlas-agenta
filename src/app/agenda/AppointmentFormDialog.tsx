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
  type AppointmentSelection,
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
  type AppointmentInput as AppointmentMutationInput,
  useCreateAppointment,
  useUpdateAppointment,
} from "@/hooks/useAppointments";
import { useAvailableSlots } from "@/hooks/useAvailableSlots";
import { useCombos } from "@/hooks/useCombos";
import { useComboServices } from "@/hooks/useComboServices";
import { useCustomers } from "@/hooks/useCustomers";
import { usePermissions } from "@/hooks/usePermissions";
import { useSegmentFeatures } from "@/hooks/useSegmentFeatures";
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
 * Diálogo de criar/editar agendamento. O operador escolhe **o que será feito**:
 * um **serviço avulso** (caminho de ADR-05) ou — só para o ramo salão, gated por
 * `useSegmentFeatures().combos` (ADR-06) — um **pacote**. A seleção é uma união
 * discriminada (`selection`), espelhando o XOR `service_id`/`combo_id` do banco.
 *
 * Deriva `ends_at` e `price_cents` no ato (read-only, nunca editáveis aqui):
 * - serviço: `starts_at + duration_minutes` e `price_cents` do serviço;
 * - pacote: `starts_at + soma(durações dos serviços do pacote)` (D-3) e
 *   `price_cents` = preço fechado do pacote (snapshot — mesmo princípio do
 *   serviço).
 * Converte a hora local do tenant → UTC na borda (helpers de ADR-05).
 *
 * A checagem de conflito local (contra o cache do dia) é feedback imediato
 * pt-BR; a trava real é a constraint de exclusão no banco (`23P01` →
 * `mapSchedulingError`). A duração efetiva (serviço ou pacote) entra no range
 * `[starts_at, ends_at)` que a `btree_gist` do banco valida.
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
  const { combos: combosFeature } = useSegmentFeatures();
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
  // Pacotes ativos ofertáveis (só carrega/importa quando o ramo expõe o modo).
  const combosQuery = useCombos({ activeOnly: true });

  const createAppointment = useCreateAppointment();
  const updateAppointment = useUpdateAppointment();

  // Seleção inicial: edição lê da linha (combo_id → modo pacote); criação sempre
  // nasce em modo serviço (o seletor de modo troca na UI quando disponível).
  const initialSelection = useMemo<AppointmentSelection>(() => {
    if (appointment?.combo_id) {
      return { kind: "combo", comboId: appointment.combo_id };
    }
    return { kind: "service", serviceId: appointment?.service_id ?? "" };
  }, [appointment?.combo_id, appointment?.service_id]);

  const emptyValues: AppointmentInput = useMemo(
    () => ({
      customerId: "",
      professionalId: lockedProfessionalId ?? prefill?.professionalId ?? "",
      selection: { kind: "service", serviceId: "" },
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
        selection: initialSelection,
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
  }, [open, appointment, timeZone, emptyValues, initialSelection, form]);

  const selection = form.watch("selection");
  const mode = selection.kind;
  const watchedServiceId =
    selection.kind === "service" ? selection.serviceId : "";
  const watchedComboId = selection.kind === "combo" ? selection.comboId : "";
  const watchedProfessionalId = form.watch("professionalId");
  const watchedDate = form.watch("date");
  const watchedTime = form.watch("time");

  const services = servicesQuery.data ?? [];
  const customers = customersQuery.data ?? [];
  const combos = combosQuery.data ?? [];

  const selectedService = useMemo(
    () => services.find((s) => s.id === watchedServiceId) ?? null,
    [services, watchedServiceId],
  );

  const selectedCombo = useMemo(
    () => combos.find((c) => c.id === watchedComboId) ?? null,
    [combos, watchedComboId],
  );

  // Serviços que compõem o pacote selecionado (só no modo pacote, com combo
  // escolhido). A soma das durações deriva `ends_at` e, portanto, o slot/range.
  const comboServiceIdsQuery = useComboServices(
    mode === "combo" && watchedComboId ? watchedComboId : null,
  );
  const comboServiceIds = comboServiceIdsQuery.data ?? [];

  // Em edição de um pacote, o combo pode ter sido INATIVADO depois (não vem em
  // `useCombos({ activeOnly: true })`). Mantemos a opção visível como
  // selecionada-porém-inativa para não perder o vínculo histórico.
  const editingInactiveCombo =
    mode === "combo" &&
    !!watchedComboId &&
    !combos.some((c) => c.id === watchedComboId);

  // Duração do pacote = soma das durações dos serviços vinculados (D-3),
  // resolvida no cliente a partir de `useComboServices` + `useServices`.
  // `useServices({ activeOnly: true })` pode não conter um serviço inativado;
  // nesse caso a parcela daquele serviço entra como 0 (defensivo). O caminho
  // feliz (serviços ativos) soma corretamente.
  const comboDurationMinutes = useMemo(() => {
    if (mode !== "combo") return null;
    if (comboServiceIds.length === 0) return null;
    return comboServiceIds.reduce((total, id) => {
      const svc = services.find((s) => s.id === id);
      return total + (svc?.duration_minutes ?? 0);
    }, 0);
  }, [mode, comboServiceIds, services]);

  // Nomes dos serviços do pacote, para o resumo "Inclui: …".
  const comboServiceNames = useMemo(() => {
    if (mode !== "combo") return [];
    return comboServiceIds
      .map((id) => services.find((s) => s.id === id)?.name)
      .filter((name): name is string => !!name);
  }, [mode, comboServiceIds, services]);

  // Duração efetiva da seleção: serviço → `duration_minutes`; pacote → soma.
  const effectiveDuration = useMemo(() => {
    if (mode === "combo") return comboDurationMinutes;
    return selectedService?.duration_minutes ?? null;
  }, [mode, comboDurationMinutes, selectedService]);

  // Preço efetivo (snapshot no submit): serviço → preço do serviço; pacote →
  // preço fechado do pacote.
  const effectivePriceCents = useMemo(() => {
    if (mode === "combo") return selectedCombo?.price_cents ?? null;
    return selectedService?.price_cents ?? null;
  }, [mode, selectedCombo, selectedService]);

  // Derivações read-only exibidas assim que a seleção + data + hora estão
  // prontas (duração e preço efetivos resolvidos).
  const derived = useMemo(() => {
    if (effectiveDuration == null || effectivePriceCents == null) return null;
    const startUtc = tenantDateTimeToUtc(watchedDate, watchedTime, timeZone);
    if (!startUtc) return null;
    const endUtc = addMinutes(startUtc, effectiveDuration);
    return {
      startUtc,
      endUtc,
      priceCents: effectivePriceCents,
      endLabel: formatTimeInTenantTz(endUtc, timeZone),
    };
  }, [
    effectiveDuration,
    effectivePriceCents,
    watchedDate,
    watchedTime,
    timeZone,
  ]);

  // Slots livres sob demanda (ADR-05): dependem de profissional + duração
  // efetiva + data. No modo pacote passamos `serviceId: null` e a duração já
  // resolvida (soma do combo); no modo serviço, o `serviceId` (compatível com
  // ADR-05). Em edição, exclui o próprio agendamento do desconto de ocupados.
  const {
    slots,
    isLoading: slotsLoading,
    isEnabled: slotsEnabled,
  } = useAvailableSlots({
    day: watchedDate,
    professionalId: watchedProfessionalId || null,
    serviceId: mode === "service" ? watchedServiceId || null : null,
    durationMinutes: mode === "combo" ? effectiveDuration : null,
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

  /** Troca o modo (serviço↔pacote) resetando o id da seleção anterior. */
  function handleModeChange(next: AppointmentSelection["kind"]) {
    if (next === mode) return;
    const nextSelection: AppointmentSelection =
      next === "combo"
        ? { kind: "combo", comboId: "" }
        : { kind: "service", serviceId: "" };
    form.setValue("selection", nextSelection, {
      shouldValidate: false,
      shouldDirty: true,
    });
  }

  async function onSubmit(values: AppointmentInput) {
    // Resolve a duração/preço efetivos e monta o payload conforme o modo.
    // `sel` é const para a união discriminada narrowar dentro dos callbacks.
    const sel = values.selection;
    let serviceId: string | null;
    let comboId: string | null;
    let durationMinutes: number | null;
    let priceCents: number | null;

    if (sel.kind === "combo") {
      const combo = combos.find((c) => c.id === sel.comboId);
      // Em edição de pacote inativado, `combo` pode não estar na lista de
      // ativos; caímos no estado selecionado (`selectedCombo`) resolvido acima.
      const resolvedCombo = combo ?? selectedCombo;
      if (!resolvedCombo) {
        form.setError("selection.comboId", {
          message: "Selecione um pacote.",
        });
        return;
      }
      if (comboDurationMinutes == null || comboDurationMinutes <= 0) {
        form.setError("selection.comboId", {
          message: "O pacote precisa de pelo menos um serviço com duração.",
        });
        return;
      }
      serviceId = null;
      comboId = resolvedCombo.id;
      durationMinutes = comboDurationMinutes;
      priceCents = resolvedCombo.price_cents;
    } else {
      const service = services.find((s) => s.id === sel.serviceId);
      if (!service) {
        form.setError("selection.serviceId", {
          message: `Selecione um ${servicoLower}.`,
        });
        return;
      }
      serviceId = service.id;
      comboId = null;
      durationMinutes = service.duration_minutes;
      priceCents = service.price_cents;
    }

    const startUtc = tenantDateTimeToUtc(values.date, values.time, timeZone);
    if (!startUtc) {
      form.setError("time", { message: "Informe um horário válido (HH:MM)." });
      return;
    }
    const endUtc = addMinutes(startUtc, durationMinutes);

    if (hasLocalConflict(startUtc, endUtc)) {
      form.setError("time", {
        message: "Este profissional já tem um agendamento neste horário.",
      });
      return;
    }

    const payload: AppointmentMutationInput = {
      customerId: values.customerId,
      professionalId: values.professionalId,
      serviceId,
      comboId,
      startsAt: startUtc.toISOString(),
      endsAt: endUtc.toISOString(),
      priceCents,
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
            {`Escolha ${clienteLower}, ${profissionalLower}, ${servicoLower} e horário. O término e o valor são calculados pela seleção.`}
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

            {/*
              Seletor de modo "Procedimento avulso / Pacote" — só para o ramo
              salão (`combosFeature`). Controle segmentado construído com os
              `Button` existentes (sem dependência nova): `role="group"` +
              `aria-pressed`, navegável por teclado e com foco visível. Para os
              demais ramos o seletor nem monta — o formulário fica idêntico a hoje.
            */}
            {combosFeature ? (
              <div
                role="group"
                aria-label={`Tipo de ${servicoLower}`}
                className="inline-flex rounded-md border border-border p-1"
              >
                <Button
                  type="button"
                  size="sm"
                  variant={mode === "service" ? "default" : "ghost"}
                  aria-pressed={mode === "service"}
                  onClick={() => handleModeChange("service")}
                >
                  {`${servicoLabelSingular} avulso`}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={mode === "combo" ? "default" : "ghost"}
                  aria-pressed={mode === "combo"}
                  onClick={() => handleModeChange("combo")}
                >
                  Pacote
                </Button>
              </div>
            ) : null}

            {mode === "service" ? (
              <FormField
                control={form.control}
                name="selection.serviceId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{servicoLabelSingular}</FormLabel>
                    <Select
                      value={field.value || undefined}
                      onValueChange={field.onChange}
                    >
                      <FormControl>
                        <SelectTrigger aria-label={servicoLabelSingular}>
                          <SelectValue
                            placeholder={`Selecione o ${servicoLower}`}
                          />
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
            ) : (
              <FormField
                control={form.control}
                name="selection.comboId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Pacote</FormLabel>
                    <Select
                      value={field.value || undefined}
                      onValueChange={field.onChange}
                    >
                      <FormControl>
                        <SelectTrigger aria-label="Pacote">
                          <SelectValue placeholder="Selecione o pacote" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {/*
                          Pacote inativado em edição: mantém a opção selecionada
                          marcada como "(inativo)" para não perder o vínculo
                          histórico (mesmo cuidado do serviço removido).
                        */}
                        {editingInactiveCombo && watchedComboId ? (
                          <SelectItem value={watchedComboId}>
                            {`${
                              appointment?.combos?.name ?? "Pacote"
                            } (inativo)`}
                          </SelectItem>
                        ) : null}
                        {combos.map((combo) => (
                          <SelectItem key={combo.id} value={combo.id}>
                            {`${combo.name} — ${formatCentsToBRL(
                              combo.price_cents,
                            )}`}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

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

            {/* Derivados read-only (término previsto + valor da seleção). */}
            {derived ? (
              <div className="rounded-md border border-border bg-muted/30 p-3 text-sm">
                <p className="text-muted-foreground">
                  Término previsto:{" "}
                  <span className="font-medium tabular-nums text-foreground">
                    {derived.endLabel}
                  </span>
                </p>
                <p className="text-muted-foreground">
                  {mode === "combo" ? "Valor do pacote:" : "Valor:"}{" "}
                  <span className="font-medium tabular-nums text-foreground">
                    {formatCentsToBRL(derived.priceCents)}
                  </span>
                </p>
                {mode === "combo" && comboServiceNames.length > 0 ? (
                  <p className="text-muted-foreground">
                    Inclui:{" "}
                    <span className="text-foreground">
                      {comboServiceNames.join(", ")}
                    </span>
                  </p>
                ) : null}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                {mode === "combo"
                  ? "Escolha o pacote e o horário para ver o término e o valor."
                  : `Escolha o ${servicoLower} e o horário para ver o término e o valor.`}
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
