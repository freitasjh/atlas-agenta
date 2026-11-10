import { useEffect, useMemo, useState } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Plus } from "lucide-react";

import { PageHeader } from "@/components/PageHeader";
import { StatePanel } from "@/components/StatePanel";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";

import { PaymentCaptureDialog } from "@/app/agenda/pagamentos/PaymentCaptureDialog";
import { paymentsMessages } from "@/app/agenda/pagamentos/payments-messages";
import { WalkInBadge } from "@/app/pdv/WalkInBadge";

import { usePermissions } from "@/hooks/usePermissions";
import { useSegmentFeatures } from "@/hooks/useSegmentFeatures";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useProfessionals } from "@/hooks/useProfessionals";
import { useServices } from "@/hooks/useServices";
import { useCombos } from "@/hooks/useCombos";
import { useAppointments } from "@/hooks/useAppointments";
import { useCreateCustomer } from "@/hooks/useCustomers";
import { newCreationKey, useCreateWalkIn } from "@/hooks/useWalkIn";
import { walkInSchema, type WalkInInput } from "@/lib/validations/pdv";
import { toE164BR } from "@/lib/phone";
import { formatCentsToBRL } from "@/lib/money";
import { paymentErrorMessage } from "@/app/agenda/pagamentos/payment-error-message";
import { PaymentApiError, PAYMENT_ERROR_MAP } from "@/lib/payment-errors";
import { toast } from "sonner";
import type { AppointmentWithRelations } from "@/types/domain";

const messages = paymentsMessages;

/** `YYYY-MM-DD` de hoje no fuso do tenant (base de "A concluir hoje"). */
function todayInTenantTz(timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

/**
 * Estado inicial do formulário de venda — também o alvo do reset pós-conclusão
 * (decisão 1a: limpar tudo). Profissional travado (papel `professional`) é
 * reposto com o próprio id para o campo nunca ficar vazio e inválido.
 */
function initialWalkInValues(professionalId: string): WalkInInput {
  return {
    professionalId,
    selection: { kind: "service", serviceId: "" },
    customerName: "",
    customerPhone: "",
    whatsappOptIn: false,
  };
}

/**
 * Tela PDV — balcão (`/app/pdv`, ADR-23): segunda porta do checkout existente.
 * Esquerda: serviço/pacote + profissional + cliente (anônimo default).
 * Direita: total + checkout em modo "venda nova". Mobile empilhado.
 * Gating: `payments === true` (salão/barbearia); `null` = loading.
 */
export function PdvPage() {
  const { canRegisterPayments, canScheduleForAnyProfessional } = usePermissions();
  const { payments, combos: combosFeature } = useSegmentFeatures();
  const { tenant, userId } = useCurrentUser();
  const timeZone = tenant?.timezone ?? "America/Sao_Paulo";

  const professionalsQuery = useProfessionals({ activeOnly: true });
  const servicesQuery = useServices({ activeOnly: true });
  const combosQuery = useCombos({ activeOnly: true });
  const createWalkIn = useCreateWalkIn();
  const createCustomer = useCreateCustomer();

  const today = todayInTenantTz(timeZone);
  const todayQuery = useAppointments({
    day: today,
    professionalId: canScheduleForAnyProfessional ? undefined : undefined,
  });

  const [captureTarget, setCaptureTarget] = useState<{
    appointment: {
      id: string;
      customerName: string;
      serviceName: string;
      professionalName: string;
      totalCents: number;
      status: "em_atendimento" | "concluido";
    };
  } | null>(null);

  // Estado explícito da identificação: o checkbox não pode derivar de campos
  // vazios, senão marcar nunca revela os inputs (bug do balcão).
  const [identify, setIdentify] = useState(false);

  const form = useForm<WalkInInput>({
    resolver: zodResolver(walkInSchema),
    defaultValues: initialWalkInValues(""),
  });

  const professionals = professionalsQuery.data ?? [];
  const services = servicesQuery.data ?? [];
  const combos = combosFeature ? (combosQuery.data ?? []) : [];

  const ownProfessional = useMemo(() => {
    if (canScheduleForAnyProfessional || !userId) return null;
    return professionals.find((p) => p.profile_id === userId) ?? null;
  }, [canScheduleForAnyProfessional, userId, professionals]);

  // Papel `professional`: o Select fica travado; o id precisa estar no form.
  // Sem isto o campo fica vazio e o operador não consegue vender.
  useEffect(() => {
    if (ownProfessional) form.setValue("professionalId", ownProfessional.id);
  }, [ownProfessional, form]);

  /** Reset total do formulário após concluir a venda (decisão 1a). */
  function resetSaleForm() {
    form.reset(initialWalkInValues(ownProfessional?.id ?? ""));
    setIdentify(false);
    form.clearErrors();
  }

  if (payments === null) {
    return (
      <div className="space-y-6" aria-busy="true">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (payments === false) {
    return (
      <div className="space-y-6">
        <PageHeader titulo={messages.pdv.title} descricao={messages.pdv.description} />
        <StatePanel
          titulo={messages.pdv.segmentOnlyTitle}
          descricao={messages.pdv.segmentOnlyDescription}
        />
      </div>
    );
  }

  const selection = form.watch("selection");
  const selectedProfessional = professionals.find(
    (p) => p.id === form.watch("professionalId"),
  );
  const selectedTotal =
    selection.kind === "service"
      ? (services.find((s) => s.id === selection.serviceId)?.price_cents ?? 0)
      : (combos.find((c) => c.id === selection.comboId)?.price_cents ?? 0);
  const selectedServiceName =
    selection.kind === "service"
      ? (services.find((s) => s.id === selection.serviceId)?.name ?? "")
      : (combos.find((c) => c.id === selection.comboId)?.name ?? "");

  // Erro da seleção (união discriminada) — superfície acessível do campo.
  const selectionError = (() => {
    const errors = form.formState.errors.selection as
      | { message?: string; serviceId?: { message?: string }; comboId?: { message?: string } }
      | undefined;
    return errors?.serviceId?.message ?? errors?.comboId?.message ?? errors?.message;
  })();

  const pendingToday = (todayQuery.data ?? []).filter(
    (a) => a.status === "em_atendimento" || a.status === "confirmado",
  );

  async function onSubmit(input: WalkInInput) {
    const hasCustomer =
      (input.customerName?.trim().length ?? 0) > 0 &&
      (input.customerPhone?.trim().length ?? 0) > 0;
    try {
      let customerId: string | null = null;
      if (hasCustomer) {
        const phone = toE164BR((input.customerPhone ?? "").trim());
        if (!phone) {
          toast.error("Informe um telefone com DDD (ex.: (11) 99999-8888).");
          return;
        }
        const customer = await createCustomer.mutateAsync({
          name: (input.customerName ?? "").trim(),
          phone,
          email: null,
          whatsappOptIn: input.whatsappOptIn,
          active: true,
        });
        customerId = customer.id;
      }
      const created = await createWalkIn.mutateAsync({
        professionalId: input.professionalId,
        selection: input.selection,
        customerId,
        creationIdempotencyKey: newCreationKey(),
      });
      toast.success(messages.pdv.successCreated);
      setCaptureTarget({
        appointment: {
          id: created.appointmentId,
          customerName: hasCustomer
            ? (input.customerName ?? "").trim()
            : messages.pdv.anonymous,
          serviceName: selectedServiceName,
          professionalName: selectedProfessional?.name ?? "",
          totalCents: selectedTotal,
          status: "em_atendimento",
        },
      });
      // Cliente é por venda: sem reset, a identificação da venda anterior vaza
      // para a próxima e pode gravar `customer_id` errado (customers não tem
      // unique por telefone). Profissional/serviço permanecem para agilizar.
      setIdentify(false);
      form.setValue("customerName", "");
      form.setValue("customerPhone", "");
      form.setValue("whatsappOptIn", false);
      form.clearErrors(["customerName", "customerPhone"]);
    } catch (error) {
      if (error instanceof PaymentApiError) {
        // Código conhecido → mensagem do próprio código (inclui `SLOT_CONFLICT`,
        // 409 da constraint de agenda). Desconhecido → fallback do PDV.
        const message = Object.prototype.hasOwnProperty.call(PAYMENT_ERROR_MAP, error.code)
          ? paymentErrorMessage(messages, error.code)
          : messages.pdv.createdError;
        toast.error(message);
      } else {
        toast.error(messages.pdv.createdError);
      }
    }
  }

  const busy = createWalkIn.isPending || createCustomer.isPending;

  return (
    <div className="space-y-6">
      <PageHeader titulo={messages.pdv.title} descricao={messages.pdv.description} />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{messages.pdv.newSale}</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <div className="space-y-1">
                <Label htmlFor="pdv-profissional">{messages.pdv.professional}</Label>
                <Controller
                  control={form.control}
                  name="professionalId"
                  render={({ field }) => (
                    <Select
                      value={field.value || "nenhum"}
                      onValueChange={(value) => {
                        // "nenhum"/vazio é sentinela visual do Select, nunca valor de domínio.
                        if (!value || value === "nenhum") return;
                        field.onChange(value);
                      }}
                      disabled={!canScheduleForAnyProfessional || !!ownProfessional}
                    >
                      <SelectTrigger id="pdv-profissional" className="w-full">
                        <SelectValue placeholder={messages.pdv.professional} />
                      </SelectTrigger>
                      <SelectContent>
                        {professionals.map((p) => (
                          <SelectItem key={p.id} value={p.id}>
                            {p.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
                {form.formState.errors.professionalId ? (
                  <p className="text-sm text-destructive" role="alert">
                    {form.formState.errors.professionalId.message}
                  </p>
                ) : null}
              </div>

              <div className="space-y-1">
                <Label htmlFor="pdv-servico">{messages.pdv.service}</Label>
                {selection.kind === "service" ? (
                  <Controller
                    control={form.control}
                    name="selection.serviceId"
                    render={({ field }) => (
                      <Select
                        value={field.value || "nenhum"}
                        onValueChange={(value) => {
                          if (!value || value === "nenhum") return;
                          form.setValue(
                            "selection",
                            { kind: "service", serviceId: value },
                            { shouldValidate: true },
                          );
                        }}
                      >
                        <SelectTrigger id="pdv-servico" className="w-full">
                          <SelectValue placeholder={messages.pdv.service} />
                        </SelectTrigger>
                        <SelectContent>
                          {services.map((s) => (
                            <SelectItem key={s.id} value={s.id}>
                              {s.name} — {formatCentsToBRL(s.price_cents)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  />
                ) : (
                  <Controller
                    control={form.control}
                    name="selection.comboId"
                    render={({ field }) => (
                      <Select
                        value={field.value || "nenhum"}
                        onValueChange={(value) => {
                          if (!value || value === "nenhum") return;
                          form.setValue(
                            "selection",
                            { kind: "combo", comboId: value },
                            { shouldValidate: true },
                          );
                        }}
                      >
                        <SelectTrigger id="pdv-servico" className="w-full">
                          <SelectValue placeholder={messages.pdv.combo} />
                        </SelectTrigger>
                        <SelectContent>
                          {combos.map((c) => (
                            <SelectItem key={c.id} value={c.id}>
                              {c.name} — {formatCentsToBRL(c.price_cents)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  />
                )}
                {combosFeature ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      form.setValue(
                        "selection",
                        selection.kind === "service"
                          ? { kind: "combo", comboId: "" }
                          : { kind: "service", serviceId: "" },
                      )
                    }
                  >
                    {selection.kind === "service" ? messages.pdv.combo : messages.pdv.service}
                  </Button>
                ) : null}
                {selectionError ? (
                  <p className="text-sm text-destructive" role="alert">
                    {selectionError}
                  </p>
                ) : null}
              </div>

              <div className="flex items-center gap-2">
                <Checkbox
                  id="pdv-identificar"
                  checked={identify}
                  onCheckedChange={(checked) => {
                    const next = checked === true;
                    setIdentify(next);
                    if (!next) {
                      form.setValue("customerName", "", { shouldValidate: true });
                      form.setValue("customerPhone", "", { shouldValidate: true });
                      form.setValue("whatsappOptIn", false);
                    }
                  }}
                />
                <Label htmlFor="pdv-identificar">{messages.pdv.identifiedToggle}</Label>
              </div>
              {identify ? (
                <div className="space-y-3">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1">
                      <Label htmlFor="pdv-cliente-nome">{messages.pdv.customerName}</Label>
                      <Input
                        id="pdv-cliente-nome"
                        autoFocus
                        aria-invalid={Boolean(form.formState.errors.customerName)}
                        aria-describedby={
                          form.formState.errors.customerName ? "pdv-cliente-nome-erro" : undefined
                        }
                        {...form.register("customerName")}
                      />
                      {form.formState.errors.customerName ? (
                        <p
                          id="pdv-cliente-nome-erro"
                          className="text-sm text-destructive"
                          role="alert"
                        >
                          {form.formState.errors.customerName.message}
                        </p>
                      ) : null}
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="pdv-cliente-fone">{messages.pdv.customerPhone}</Label>
                      <Input
                        id="pdv-cliente-fone"
                        aria-invalid={Boolean(form.formState.errors.customerPhone)}
                        aria-describedby={
                          form.formState.errors.customerPhone ? "pdv-cliente-fone-erro" : undefined
                        }
                        {...form.register("customerPhone")}
                      />
                      {form.formState.errors.customerPhone ? (
                        <p
                          id="pdv-cliente-fone-erro"
                          className="text-sm text-destructive"
                          role="alert"
                        >
                          {form.formState.errors.customerPhone.message}
                        </p>
                      ) : null}
                    </div>
                  </div>
                  <Controller
                    control={form.control}
                    name="whatsappOptIn"
                    render={({ field }) => (
                      <div className="flex items-center gap-2">
                        <Checkbox
                          id="pdv-whatsapp-optin"
                          checked={field.value}
                          onCheckedChange={(checked) => field.onChange(checked === true)}
                        />
                        <Label htmlFor="pdv-whatsapp-optin">{messages.pdv.whatsappOptIn}</Label>
                      </div>
                    )}
                  />
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">{messages.pdv.anonymousHint}</p>
              )}

              <div className="flex items-center justify-between pt-2">
                <p className="text-sm text-muted-foreground">{messages.pdv.total}</p>
                <p className="font-display text-2xl font-semibold tabular-nums">
                  {formatCentsToBRL(selectedTotal)}
                </p>
              </div>

              <Button type="submit" disabled={busy || !canRegisterPayments} className="w-full">
                <Plus aria-hidden="true" />
                {busy ? messages.pdv.creating : messages.pdv.createSale}
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{messages.pdv.pendingList}</CardTitle>
          </CardHeader>
          <CardContent>
            {todayQuery.isLoading ? (
              <Skeleton className="h-20 w-full" />
            ) : pendingToday.length === 0 ? (
              <p className="text-sm text-muted-foreground">{messages.pdv.pendingEmpty}</p>
            ) : (
              <ul className="space-y-3">
                {pendingToday.map((appointment: AppointmentWithRelations) => (
                  <li
                    key={appointment.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border p-3"
                  >
                    <div className="min-w-0 space-y-1">
                      <div className="flex items-center gap-2 font-medium">
                        {appointment.customers?.name ??
                          (appointment.customer_id == null
                            ? messages.pdv.anonymous
                            : "Cliente removido")}
                        {appointment.origin === "walk_in" ? <WalkInBadge /> : null}
                      </div>
                      <p className="text-sm text-muted-foreground">
                        {appointment.combos?.name ??
                          appointment.services?.name ??
                          "Serviço removido"}
                        {" · "}
                        {appointment.professionals?.name ?? "Profissional removido"} ·{" "}
                        {formatCentsToBRL(appointment.price_cents)}
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={!canRegisterPayments}
                      onClick={() =>
                        setCaptureTarget({
                          appointment: {
                            id: appointment.id,
                            customerName:
                              appointment.customers?.name ?? messages.pdv.anonymous,
                            serviceName:
                              appointment.combos?.name ??
                              appointment.services?.name ??
                              "",
                            professionalName: appointment.professionals?.name ?? "",
                            totalCents: appointment.price_cents,
                            status: appointment.status as "em_atendimento" | "concluido",
                          },
                        })
                      }
                    >
                      {messages.pdv.openPayment}
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      {captureTarget ? (
        <PaymentCaptureDialog
          open
          mode="close"
          appointment={captureTarget.appointment}
          onOpenChange={(open) => {
            if (!open) setCaptureTarget(null);
          }}
          onCompleted={() => {
            setCaptureTarget(null);
            resetSaleForm();
            toast.success(messages.pdv.saleCompleted);
            void todayQuery.refetch();
          }}
        />
      ) : null}
    </div>
  );
}
