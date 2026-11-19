import { useEffect, useMemo, useRef, useState } from "react";
import type { MutableRefObject } from "react";
import { Link } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/StatusBadge";
import { DepositBadge } from "@/app/agenda/DepositBadge";
import {
  DepositChargePanel,
} from "@/app/agenda/DepositChargePanel";
import type { DepositCharge } from "@/lib/validations/deposit";

import {
  appointmentSchema,
  type AppointmentInput,
  type AppointmentSelection,
} from "@/lib/validations/scheduling";
import {
  addMinutes,
  formatDateInTenantTz,
  formatTimeInTenantTz,
  tenantDateTimeToUtc,
  toTenantLocal,
} from "@/lib/datetime";
import { formatCentsToBRL } from "@/lib/money";
import { canSeeFinancials } from "@/app/agenda/model/financialMask";
import { hasLocalConflict } from "@/app/agenda/scheduling-conflict";
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
import { usePlanEntitlements } from "@/hooks/usePlanEntitlements";
import { useSegmentFeatures } from "@/hooks/useSegmentFeatures";
import { useSegmentTerms } from "@/hooks/useSegmentTerms";
import { useProfessionals, useScheduleValidity } from "@/hooks/useProfessionals";
import { useScheduleOverrides } from "@/hooks/useScheduleOverrides";
import { useWorkingHours } from "@/hooks/useWorkingHours";
import { useServices } from "@/hooks/useServices";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { SlotPicker, type SlotEmptyReason } from "@/app/agenda/SlotPicker";
import { useAppointmentDraft } from "@/app/agenda/useAppointmentDraft";
import { ProntuarioTab } from "@/app/agenda/prontuario/ProntuarioTab";
import { AppointmentSettlementDialog } from "@/app/agenda/pagamentos/AppointmentSettlementDialog";
import type { AppointmentWithRelations } from "@/types/domain";

export interface AppointmentDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  appointment?: AppointmentWithRelations | null;
  day: string;
  timeZone: string;
  lockedProfessionalId: string | null;
  dayAppointments: AppointmentWithRelations[];
  /** Charge PIX do depósito (Fase 4, ADR-12). `null`/ausente = sem painel. */
  depositCharge?: DepositCharge | null;
  /** Reenvia o QR da charge. O pai executa o request. */
  onResendDepositQr?: () => Promise<void> | void;
  /** Cancela a charge + atendimento. O pai executa o request. */
  onCancelDepositCharge?: () => Promise<void> | void;
  prefill?: {
    professionalId?: string;
    time?: string;
    customerId?: string;
    serviceId?: string;
    comboId?: string;
  } | null;
}

const WIZARD_STEPS = ["Quem e o quê", "Quando", "Revisar"] as const;

function weekdayOf(day: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!match) return -1;
  return new Date(
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])),
  ).getUTCDay();
}

function isWithinValidity(
  day: string,
  start: string | null,
  end: string | null,
): boolean {
  if (start && day < start) return false;
  if (end && day > end) return false;
  return true;
}

/**
 * Drawer de criar/editar agendamento (ADR-06, substitui o `Dialog` central de
 * 789 linhas). `Sheet` lateral (`side=right`; bottom sheet mobile) com 3 abas:
 * Dados / Pagamento / Histórico.
 *
 * Dois modos no mesmo Sheet:
 * - **criar**: wizard em 3 passos dentro da aba Dados (Quem/O quê → Quando →
 *   Revisar) com validação por passo + rascunho em `localStorage` (por
 *   tenant+dia, limpo ao salvar/descartar);
 * - **editar**: abre direto na aba Dados com o formulário completo.
 *
 * A aba Pagamento é gated (checkout tri-state: segmento OU `aestheticCheckout`
 * da ADR-07 + `canRegisterPayments`): indisponível vira estado-guia + CTA, nunca quebra o Drawer. A aba Histórico
 * é read-only (criado/confirmado/estado atual — sem tabela de auditoria).
 *
 * Fechado = shell vazio: o corpo (queries + form) só monta com `open`, então
 * a lista da agenda não paga nenhuma query do Drawer até abri-lo.
 */
export function AppointmentDrawer(props: AppointmentDrawerProps) {
  const { open, onOpenChange } = props;
  const guardRef = useRef<((next: boolean) => boolean) | null>(null);
  // D1: trigger que abriu o Drawer. Capturado no render de abertura (antes do
  // FocusScope do Radix mover o foco no commit); ao fechar, o foco volta a ele.
  const openerRef = useRef<HTMLElement | null>(null);
  if (open && openerRef.current === null && typeof document !== "undefined") {
    const active = document.activeElement;
    openerRef.current = active instanceof HTMLElement ? active : null;
  }
  useEffect(() => {
    if (!open && openerRef.current) {
      const el = openerRef.current;
      openerRef.current = null;
      if (el.isConnected) el.focus();
    }
  }, [open ]);

  function handleOpenChange(next: boolean) {
    if (guardRef.current && !guardRef.current(next)) return;
    onOpenChange(next);
  }

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      {open ? (
        <AppointmentDrawerBody {...props} guardRef={guardRef} />
      ) : null}
    </Sheet>
  );
}

function AppointmentDrawerBody({
  onOpenChange,
  appointment,
  day,
  timeZone,
  lockedProfessionalId,
  dayAppointments,
  prefill,
  guardRef,
  depositCharge,
  onResendDepositQr,
  onCancelDepositCharge,
}: Omit<AppointmentDrawerProps, "open"> & {
  guardRef: MutableRefObject<((next: boolean) => boolean) | null>;
}) {
  const isEdit = !!appointment;

  const { canEditAnySchedule, canEditOwnSchedule, canRegisterPayments } =
    usePermissions();
  const { combos: combosFeature, payments: paymentsFeature } =
    useSegmentFeatures();
  const entitlements = usePlanEntitlements();
  const prontuarioEntitled = entitlements?.prontuario === true;
  // ADR-07 (G5): clínica tem `payments:false` no segmento e ganha o checkout
  // via entitlement `aestheticCheckout` (ADR-01). `segment-features` intocado;
  // `null` (tenant não resolvido) mostra skeleton, nunca o fluxo legado.
  const aestheticCheckout = entitlements?.aestheticCheckout === true;
  const checkoutEnabled =
    paymentsFeature === true ||
    (paymentsFeature === false && aestheticCheckout);
  const {
    servicoLabelSingular,
    profissionalLabelSingular,
    clienteLabel,
  } = useSegmentTerms();
  const servicoLower = servicoLabelSingular.toLowerCase();
  const profissionalLower = profissionalLabelSingular.toLowerCase();
  const clienteLower = clienteLabel.toLowerCase();
  const { role, tenantId } = useCurrentUser();
  const canSeeMoney = canSeeFinancials(role ?? "receptionist");

  const customersQuery = useCustomers({ activeOnly: true });
  const professionalsQuery = useProfessionals({ activeOnly: true });
  const servicesQuery = useServices({ activeOnly: true });
  const combosQuery = useCombos({ activeOnly: true });
  const createAppointment = useCreateAppointment();
  const updateAppointment = useUpdateAppointment();

  const [wizardStep, setWizardStep] = useState(0);
  const [tab, setTab] = useState("dados");
  const [settlementOpen, setSettlementOpen] = useState(false);
  const [confirmDiscardDraft, setConfirmDiscardDraft] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const [draftRestored, setDraftRestored] = useState(false);
  // RHF `isDirty` depende de subscription de render; para a guarda de fechar
  // usamos comparação determinística contra os valores do (re)abrir.
  const initialValuesRef = useRef<string>("");
  function snapshotInitial() {
    initialValuesRef.current = JSON.stringify(form.getValues());
  }
  function isDirtyNow(): boolean {
    return JSON.stringify(form.getValues()) !== initialValuesRef.current;
  }
  const { draft, save: saveDraft, clear: clearDraft } = useAppointmentDraft(
    tenantId,
    day,
  );

  const initialSelection = useMemo<AppointmentSelection>(() => {
    if (appointment?.combo_id) {
      return { kind: "combo", comboId: appointment.combo_id };
    }
    return { kind: "service", serviceId: appointment?.service_id ?? "" };
  }, [appointment?.combo_id, appointment?.service_id]);

  const emptyValues: AppointmentInput = useMemo(
    () => ({
      customerId: prefill?.customerId ?? "",
      professionalId: lockedProfessionalId ?? prefill?.professionalId ?? "",
      selection: prefill?.comboId
        ? { kind: "combo", comboId: prefill.comboId }
        : {
            kind: "service",
            serviceId: prefill?.serviceId ?? "",
          },
      date: day,
      time: prefill?.time ?? "",
    }),
    [
      day,
      lockedProfessionalId,
      prefill?.professionalId,
      prefill?.time,
      prefill?.customerId,
      prefill?.serviceId,
      prefill?.comboId,
    ],
  );

  const form = useForm<AppointmentInput>({
    resolver: zodResolver(appointmentSchema),
    defaultValues: emptyValues,
  });

  // Ao montar (corpo só monta com `open`): edição lê a linha; criação prioriza
  // prefill (clique-em-vazio / Duplicar), depois o rascunho salvo, depois os
  // valores vazios do dia.
  useEffect(() => {
    setWizardStep(0);
    setTab("dados");
    setConfirmClose(false);
    setConfirmDiscardDraft(false);
    if (appointment) {      const local = toTenantLocal(appointment.starts_at, timeZone);
      form.reset({
        customerId: appointment.customer_id ?? "",
        professionalId: appointment.professional_id,
        selection: initialSelection,
        date: `${local.year.toString().padStart(4, "0")}-${local.month
          .toString()
          .padStart(2, "0")}-${local.day.toString().padStart(2, "0")}`,
        time: `${local.hour.toString().padStart(2, "0")}:${local.minute
          .toString()
          .padStart(2, "0")}`,
      });
      setDraftRestored(false);
      snapshotInitial();
    } else if (prefill) {
      form.reset(emptyValues);
      setDraftRestored(false);
      snapshotInitial();
    } else if (draft) {
      form.reset({
        customerId: draft.customerId,
        professionalId: draft.professionalId,
        selection: draft.selection,
        date: draft.date,
        time: draft.time,
      });
      setDraftRestored(true);
      snapshotInitial();
    } else {
      form.reset(emptyValues);
      setDraftRestored(false);
      snapshotInitial();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Guarda de fechar com dirty para o shell (overlay/Esc/X passam por ela).
  useEffect(() => {
    guardRef.current = (next: boolean) => {
      if (!next && isDirtyNow() && !confirmClose) {
        setConfirmClose(true);
        return false;
      }
      return true;
    };
  });

  const selection = form.watch("selection");
  const mode = selection.kind;
  const watchedServiceId =
    selection.kind === "service" ? selection.serviceId : "";
  const watchedComboId = selection.kind === "combo" ? selection.comboId : "";
  const watchedProfessionalId = form.watch("professionalId");
  const watchedDate = form.watch("date");
  const watchedTime = form.watch("time");

  // Rascunho também no passo 2: trocar data/hora persiste sem esperar o
  // Avançar (reload no passo 2 mantém o time). Só no criar; edição nunca
  // usa rascunho.
  function persistStep2Draft(timeOverride?: string) {
    if (isEdit) return;
    const values = form.getValues();
    saveDraft({
      customerId: values.customerId,
      professionalId: values.professionalId,
      selection: values.selection,
      date: values.date,
      time: timeOverride ?? values.time,
    });
  }
  useEffect(() => {
    if (isEdit || wizardStep !== 1) return;
    const timer = setTimeout(() => {
      persistStep2Draft();
    }, 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watchedDate, watchedTime, wizardStep]);

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

  const comboServiceIdsQuery = useComboServices(
    mode === "combo" && watchedComboId ? watchedComboId : null,
  );
  const comboServiceIds = comboServiceIdsQuery.data ?? [];

  const editingInactiveCombo =
    mode === "combo" &&
    !!watchedComboId &&
    !combos.some((c) => c.id === watchedComboId);

  const comboDurationMinutes = useMemo(() => {
    if (mode !== "combo") return null;
    if (comboServiceIds.length === 0) return null;
    return comboServiceIds.reduce((total, id) => {
      const svc = services.find((s) => s.id === id);
      return total + (svc?.duration_minutes ?? 0);
    }, 0);
  }, [mode, comboServiceIds, services]);

  const effectiveDuration = useMemo(() => {
    if (mode === "combo") return comboDurationMinutes;
    return selectedService?.duration_minutes ?? null;
  }, [mode, comboDurationMinutes, selectedService]);

  const effectivePriceCents = useMemo(() => {
    if (mode === "combo") return selectedCombo?.price_cents ?? null;
    return selectedService?.price_cents ?? null;
  }, [mode, selectedCombo, selectedService]);

  const derived = useMemo(() => {
    if (effectiveDuration == null || effectivePriceCents == null) return null;
    const startUtc = tenantDateTimeToUtc(watchedDate, watchedTime, timeZone);
    if (!startUtc) return null;
    return {
      startUtc,
      endUtc: addMinutes(startUtc, effectiveDuration),
      priceCents: effectivePriceCents,
      endLabel: formatTimeInTenantTz(
        addMinutes(startUtc, effectiveDuration).toISOString(),
        timeZone,
      ),
    };
  }, [effectiveDuration, effectivePriceCents, watchedDate, watchedTime, timeZone]);

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
    if (override) return override.is_closed ? "folga" : "sem-slots";
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

  const canConfigureSchedule =
    canEditAnySchedule ||
    (canEditOwnSchedule && activeProfessionalId === lockedProfessionalId);
  const configureScheduleHref =
    canConfigureSchedule && activeProfessionalId
      ? `/app/config/profissionais/${activeProfessionalId}/horarios`
      : undefined;

  const isSaving = createAppointment.isPending || updateAppointment.isPending;

  const professionals = useMemo(() => {
    const all = professionalsQuery.data ?? [];
    if (lockedProfessionalId) {
      return all.filter((p) => p.id === lockedProfessionalId);
    }
    return all;
  }, [professionalsQuery.data, lockedProfessionalId]);

  const localConflict =
    derived != null &&
    hasLocalConflict(
      dayAppointments,
      appointment?.id,
      watchedProfessionalId,
      derived.startUtc,
      derived.endUtc,
    );

  function handleModeChange(next: AppointmentSelection["kind"]) {
    if (next === mode) return;
    form.setValue(
      "selection",
      next === "combo"
        ? { kind: "combo", comboId: "" }
        : { kind: "service", serviceId: "" },
      { shouldValidate: false, shouldDirty: true },
    );
  }

  /** Avanço do wizard com validação por passo + rascunho silencioso. */
  async function handleNext() {
    const fields =
      wizardStep === 0
        ? (["customerId", "professionalId", "selection"] as const)
        : (["date", "time"] as const);
    const valid = await form.trigger([...fields]);
    if (!valid) return;
    const values = form.getValues();
    saveDraft({
      customerId: values.customerId,
      professionalId: values.professionalId,
      selection: values.selection,
      date: values.date,
      time: values.time,
    });
    setDraftRestored(false);
    setWizardStep((step) => Math.min(step + 1, WIZARD_STEPS.length - 1));
  }

  function handleDiscardDraft() {
    if (!confirmDiscardDraft) {
      setConfirmDiscardDraft(true);
      return;
    }
    clearDraft();
    setConfirmDiscardDraft(false);
    setDraftRestored(false);
    form.reset(emptyValues);
  }

  /** Descartar-e-fechar a partir da barra de confirmação (pula a guarda). */
  function handleDiscardAndClose() {
    if (!isEdit) clearDraft();
    setConfirmClose(false);
    onOpenChange(false);
  }

  async function onSubmit(values: AppointmentInput) {
    const sel = values.selection;
    let serviceId: string | null;
    let comboId: string | null;
    let durationMinutes: number | null;
    let priceCents: number | null;

    if (sel.kind === "combo") {
      const resolvedCombo = combos.find((c) => c.id === sel.comboId) ?? selectedCombo;
      if (!resolvedCombo) {
        form.setError("selection.comboId", { message: "Selecione um pacote." });
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

    if (
      hasLocalConflict(
        dayAppointments,
        appointment?.id,
        values.professionalId,
        startUtc,
        endUtc,
      )
    ) {
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
        clearDraft();
      }
      onOpenChange(false);
    } catch (error) {
      const message = mapSchedulingError(error);
      if (message === "Este profissional já tem um agendamento neste horário.") {
        form.setError("time", { message });
      }
      toast.error(message);
    }
  }

  const showWizard = !isEdit;
  const whoFields =
    wizardStep === 0 || isEdit ? (
      <>
        <FormField
          control={form.control}
          name="customerId"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{clienteLabel}</FormLabel>
              <Select value={field.value || undefined} onValueChange={field.onChange}>
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
                    <SelectValue placeholder={`Selecione o ${profissionalLower}`} />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {professionals.map((professional) => (
                    <SelectItem key={professional.id} value={professional.id}>
                      {professional.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />
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
                <Select value={field.value || undefined} onValueChange={field.onChange}>
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
        ) : (
          <FormField
            control={form.control}
            name="selection.comboId"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Pacote</FormLabel>
                <Select value={field.value || undefined} onValueChange={field.onChange}>
                  <FormControl>
                    <SelectTrigger aria-label="Pacote">
                      <SelectValue placeholder="Selecione o pacote" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {editingInactiveCombo && watchedComboId ? (
                      <SelectItem value={watchedComboId}>
                        {`${appointment?.combos?.name ?? "Pacote"} (inativo)`}
                      </SelectItem>
                    ) : null}
                    {combos.map((combo) => (
                      <SelectItem key={combo.id} value={combo.id}>
                        {`${combo.name} — ${formatCentsToBRL(combo.price_cents)}`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
        )}
      </>
    ) : null;

  const whenFields =
    wizardStep === 1 || isEdit ? (
      <>
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
                  onSelect={(time) => {
                    form.setValue("time", time, {
                      shouldValidate: true,
                      shouldDirty: true,
                    });
                    persistStep2Draft(time);
                  }}
                  configureScheduleHref={configureScheduleHref}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      </>
    ) : null;

  const reviewFields =
    wizardStep === 2 ? (
      <div className="space-y-3">
        {derived ? (
          <div className="space-y-1 rounded-md border border-border bg-muted/30 p-3 text-sm">
            <p className="text-muted-foreground">
              Término previsto:{" "}
              <span className="font-medium tabular-nums text-foreground">
                {derived.endLabel}
              </span>
            </p>
            {canSeeMoney ? (
              <p className="text-muted-foreground">
                {mode === "combo" ? "Valor do pacote:" : "Valor:"}{" "}
                <span className="font-medium tabular-nums text-foreground">
                  {formatCentsToBRL(derived.priceCents)}
                </span>
              </p>
            ) : (
              <p className="text-muted-foreground">
                O valor é visível para o administrador.
              </p>
            )}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            Volte e escolha o horário para ver o resumo.
          </p>
        )}
        {localConflict ? (
          <p role="alert" className="text-sm font-medium text-destructive">
            Este profissional já tem um agendamento neste horário.
          </p>
        ) : null}
      </div>
    ) : null;

  const showDepositPanel =
    isEdit && appointment?.status === "aguardando_deposito";

  const depositPanel = !showDepositPanel ? null : depositCharge ? (
    <DepositChargePanel
      charge={depositCharge}
      onResendQr={() => onResendDepositQr?.()}
      onCancel={() => onCancelDepositCharge?.()}
    />
  ) : (
    <p className="text-sm text-muted-foreground">
      Aguardando depósito — a cobrança PIX aparece aqui assim que for gerada.
    </p>
  );

  const paymentTab = !isEdit ? (
    <p className="text-sm text-muted-foreground">
      Salve o agendamento para gerenciar pagamentos.
    </p>
  ) : paymentsFeature === null ? (
    <div className="space-y-2" aria-busy="true" aria-label="Verificando formas de pagamento">
      <Skeleton className="h-10 w-full" />
      <Skeleton className="h-10 w-full" />
    </div>
  ) : !checkoutEnabled ? (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Fechamento indisponível neste plano. O agendamento segue normal — só o
        fechamento com formas de pagamento está desligado.
      </p>
      <Button asChild variant="outline">
        <Link to="/app/config/plano">Ver plano</Link>
      </Button>
    </div>
  ) : !canRegisterPayments ? (
    <p className="text-sm text-muted-foreground">
      Seu perfil não tem permissão para registrar pagamentos.
    </p>
  ) : (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Gerencie o fechamento deste atendimento sem sair do Drawer.
      </p>
      <Button variant="outline" onClick={() => setSettlementOpen(true)}>
        Abrir fechamento
      </Button>
      {settlementOpen && appointment ? (
        <AppointmentSettlementDialog
          open
          appointmentId={appointment.id}
          onOpenChange={(next) => {
            if (!next) setSettlementOpen(false);
          }}
        />
      ) : null}
    </div>
  );

  const historyTab = !isEdit || !appointment ? (
    <p className="text-sm text-muted-foreground">
      O histórico aparece após salvar o agendamento.
    </p>
  ) : (
    <ol className="space-y-3">
      <li className="flex items-center justify-between gap-2 text-sm">
        <span className="text-muted-foreground">Criado em</span>
        <span className="font-medium tabular-nums text-foreground">
          {formatDateInTenantTz(appointment.created_at, timeZone)}
        </span>
      </li>
      {appointment.confirmed_at ? (
        <li className="flex items-center justify-between gap-2 text-sm">
          <span className="text-muted-foreground">Confirmado em</span>
          <span className="font-medium tabular-nums text-foreground">
            {formatDateInTenantTz(appointment.confirmed_at, timeZone)}
          </span>
        </li>
      ) : null}
      <li className="flex items-center justify-between gap-2 text-sm">
        <span className="text-muted-foreground">Estado atual</span>
        <span className="flex flex-wrap items-center justify-end gap-2">
          <StatusBadge status={appointment.status} />
          {appointment.status === "aguardando_deposito" ? (
            <DepositBadge />
          ) : null}
        </span>
      </li>
    </ol>
  );

  const prontuarioTab =
    !isEdit || !appointment ? (
      <p className="text-sm text-muted-foreground">
        O prontuário fica disponível após salvar o agendamento.
      </p>
    ) : (
      <ProntuarioTab
        appointmentId={appointment.id}
        customerId={appointment.customer_id}
        role={role ?? "receptionist"}
        entitled={entitlements?.prontuario ?? null}
        active={tab === "prontuario"}
        timeZone={timeZone}
      />
    );

  return (
    <SheetContent
      side="right"
        className="flex w-full flex-col overflow-x-clip p-6 max-sm:inset-x-0 max-sm:bottom-0 max-sm:top-auto max-sm:h-auto max-sm:max-h-[85vh] max-sm:w-full max-sm:rounded-t-2xl sm:max-w-lg"
      >
        <SheetHeader>
          <SheetTitle>{isEdit ? "Editar agendamento" : "Novo agendamento"}</SheetTitle>
          <SheetDescription>
            {showWizard
              ? `Passo ${wizardStep + 1} de ${WIZARD_STEPS.length}: ${WIZARD_STEPS[wizardStep]}.`
              : "Ajuste os dados do agendamento."}
          </SheetDescription>
        </SheetHeader>

        {showWizard ? (
          <ol aria-label="Progresso da criação" className="flex gap-1 pt-2">
            {WIZARD_STEPS.map((label, index) => (
              <li key={label} className="flex-1">
                <span
                  aria-current={index === wizardStep ? "step" : undefined}
                  className={
                    index === wizardStep
                      ? "block rounded-full bg-primary px-2 py-1 text-center text-xs font-medium text-primary-foreground"
                      : index < wizardStep
                        ? "block rounded-full bg-primary/20 px-2 py-1 text-center text-xs text-muted-foreground"
                        : "block rounded-full bg-muted px-2 py-1 text-center text-xs text-muted-foreground"
                  }
                >
                  {label}
                </span>
              </li>
            ))}
          </ol>
        ) : null}

        {draftRestored ? (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-muted/30 p-3">
            <p className="text-sm text-muted-foreground">
              Rascunho restaurado. Continue de onde parou.
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleDiscardDraft}
            >
              {confirmDiscardDraft ? "Confirmar descarte" : "Descartar"}
            </Button>
          </div>
        ) : null}

        <Tabs value={tab} onValueChange={setTab} className="flex min-h-0 flex-1 flex-col">
          {/* B1: 4 abas em linha única sempre; scroll horizontal em 375px, sem
              scroll-X da página. B3: underline além da cor na aba ativa. */}
          <TabsList className="flex w-full gap-1 overflow-x-auto">
            <TabsTrigger
              value="dados"
              className="min-w-0 flex-1 shrink-0 data-[state=active]:underline data-[state=active]:underline-offset-4"
            >
              Dados
            </TabsTrigger>
            <TabsTrigger
              value="pagamento"
              className="min-w-0 flex-1 shrink-0 data-[state=active]:underline data-[state=active]:underline-offset-4"
            >
              Pagamento
            </TabsTrigger>
            <TabsTrigger
              value="historico"
              className="min-w-0 flex-1 shrink-0 data-[state=active]:underline data-[state=active]:underline-offset-4"
            >
              Histórico
            </TabsTrigger>
            <TabsTrigger
              value="prontuario"
              title={
                entitlements === null
                  ? "Verificando plano…"
                  : prontuarioEntitled
                    ? undefined
                    : "Prontuário não incluído no plano atual"
              }
              className="min-w-0 flex-1 shrink-0 data-[state=active]:underline data-[state=active]:underline-offset-4"
            >
              Prontuário
            </TabsTrigger>
          </TabsList>

          <div className="min-h-0 flex-1 overflow-y-auto py-4">
            {/* B3: painéis com role=tabpanel + hidden quando inativos
                (forceMount mantém o upsell da aba bloqueada no DOM). */}
            <TabsContent value="dados" forceMount hidden={tab !== "dados"} className="mt-0 min-w-0 space-y-5">
              <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmit)} className="min-w-0 space-y-5">
                  {showWizard
                    ? wizardStep === 0
                      ? whoFields
                      : wizardStep === 1
                        ? whenFields
                        : reviewFields
                    : (
                      <>
                        {whoFields}
                        {whenFields}
                      </>
                    )}
                  {localConflict && !showWizard ? (
                    <p role="alert" className="text-sm font-medium text-destructive">
                      Este profissional já tem um agendamento neste horário.
                    </p>
                  ) : null}
                  {showWizard ? null : (
                    <div className="flex flex-col gap-2">
                      <Button type="submit" disabled={isSaving}>
                        {isSaving ? (
                          <>
                            <Loader2 className="animate-spin" aria-hidden="true" />
                            Salvando…
                          </>
                        ) : (
                          "Salvar alterações"
                        )}
                      </Button>
                    </div>
                  )}
                </form>
              </Form>
            </TabsContent>
            <TabsContent value="pagamento" forceMount hidden={tab !== "pagamento"} className="mt-0 min-w-0 space-y-4">
              {depositPanel}
              {paymentTab}
            </TabsContent>
            <TabsContent value="historico" forceMount hidden={tab !== "historico"} className="mt-0 min-w-0">
              {historyTab}
            </TabsContent>
            <TabsContent value="prontuario" forceMount hidden={tab !== "prontuario"} className="mt-0 min-w-0">
              {prontuarioTab}
            </TabsContent>
          </div>
        </Tabs>

        {showWizard && tab === "dados" ? (
          <div className="flex flex-col gap-2 border-t pt-4">
            <div className="flex justify-between gap-2">
              {wizardStep > 0 ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setWizardStep((step) => step - 1)}
                >
                  Voltar
                </Button>
              ) : (
                <span />
              )}
              {wizardStep < WIZARD_STEPS.length - 1 ? (
                <Button type="button" onClick={() => void handleNext()}>
                  Avançar
                </Button>
              ) : (
                <Button
                  type="button"
                  disabled={isSaving}
                  onClick={() => void form.handleSubmit(onSubmit)()}
                >
                  {isSaving ? (
                    <>
                      <Loader2 className="animate-spin" aria-hidden="true" />
                      Salvando…
                    </>
                  ) : (
                    "Salvar agendamento"
                  )}
                </Button>
              )}
            </div>
          </div>
        ) : null}

        {confirmClose ? (
          <div
            role="alertdialog"
            aria-label="Descartar alterações"
            className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3"
          >
            <p className="text-sm">
              Descartar alterações e fechar?
            </p>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setConfirmClose(false)}
              >
                Manter editando
              </Button>
              <Button
                type="button"
                variant="destructive"
                size="sm"
                onClick={handleDiscardAndClose}
              >
                Descartar e fechar
              </Button>
            </div>
          </div>
        ) : null}
    </SheetContent>
  );
}
