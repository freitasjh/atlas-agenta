import { useEffect, useState } from "react";
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
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { MoneyInput } from "@/components/MoneyInput";
import { ServiceProfessionalsField } from "@/app/config/servicos/ServiceProfessionalsField";

import { serviceSchema, applyDepositEntitlement, type ServiceInput } from "@/lib/validations/catalog";
import {
  EMPTY_DEPOSIT_CONFIG,
  type DepositConfigInput,
} from "@/lib/validations/deposit";
import { DepositConfigSection } from "@/app/config/servicos/DepositConfigSection";
import { usePlanEntitlements } from "@/hooks/usePlanEntitlements";
import { useCreateService, useUpdateService } from "@/hooks/useServices";
import {
  insertServiceProfessionals,
  useServiceProfessionals,
  useSetServiceProfessionals,
} from "@/hooks/useServiceProfessionals";
import {
  useResources,
  useServiceResources,
  useSetServiceResources,
  insertServiceResources,
} from "@/hooks/useResources";
import type { Service } from "@/types/domain";

interface ServiceFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Serviço a editar; `null`/ausente cria um novo. */
  service?: Service | null;
}

const EMPTY_VALUES: ServiceInput = {
  name: "",
  durationMinutes: 30,
  processingMinutes: 0,
  priceCents: 0,
  backbarCostCents: 0,
  active: true,
  deposit: EMPTY_DEPOSIT_CONFIG,
};

/** Mapeia as colunas `deposit_*` (quando o backend as retorna) para o form. */
function depositFromService(service: Service): DepositConfigInput {
  if (service.deposit_enabled !== true) return EMPTY_DEPOSIT_CONFIG;
  return {
    enabled: true,
    type: service.deposit_type ?? null,
    value: service.deposit_value ?? 0,
    deadlineHours: service.deposit_deadline_hours ?? 24,
    refundPolicy: service.deposit_refund_policy ?? "none",
    refundPercent: service.deposit_refund_percent ?? null,
  };
}

/**
 * Diálogo de criar/editar serviço (react-hook-form + `serviceSchema`). O preço
 * é digitado em R$ via `MoneyInput` e trafega em centavos. A seção N:N
 * "Profissionais que executam" (D6) é editada aqui dentro: no modo edição o
 * estado inicial vem de `useServiceProfessionals`; ao salvar, o diff é aplicado
 * por `useSetServiceProfessionals`. Num serviço novo, o vínculo é aplicado após
 * a criação.
 */
export function ServiceFormDialog({
  open,
  onOpenChange,
  service,
}: ServiceFormDialogProps) {
  const isEdit = !!service;

  const createService = useCreateService();
  const updateService = useUpdateService();

  const existingLinks = useServiceProfessionals(service?.id ?? null);
  const setServiceProfessionals = useSetServiceProfessionals(service?.id ?? "");

  const resourcesQuery = useResources({ activeOnly: true });
  const existingResourceLinks = useServiceResources(service?.id ?? null);
  const setServiceResources = useSetServiceResources(service?.id ?? "");

  const [selectedProfessionals, setSelectedProfessionals] = useState<string[]>(
    [],
  );
  const [selectedResources, setSelectedResources] = useState<
    Record<string, number>
  >({});

  const form = useForm<ServiceInput>({
    resolver: zodResolver(serviceSchema),
    defaultValues: EMPTY_VALUES,
  });
  const entitlements = usePlanEntitlements();
  const depositoEntitled = entitlements?.deposito === true;
  const depositValue = form.watch("deposit") ?? EMPTY_DEPOSIT_CONFIG;

  // Ao (re)abrir, sincroniza o form com o serviço selecionado (ou valores novos).
  useEffect(() => {
    if (!open) return;
    if (service) {
      form.reset({
        name: service.name,
        durationMinutes: service.duration_minutes,
        processingMinutes: service.processing_minutes ?? 0,
        priceCents: service.price_cents,
        backbarCostCents: service.backbar_cost_cents ?? 0,
        active: service.active,
        deposit: depositFromService(service),
      });
    } else {
      form.reset(EMPTY_VALUES);
      setSelectedProfessionals([]);
      setSelectedResources({});
    }
  }, [open, service, form]);

  // No modo edição, popular a seleção N:N quando os vínculos carregarem.
  useEffect(() => {
    if (open && service && existingLinks.data) {
      setSelectedProfessionals(existingLinks.data);
    }
  }, [open, service, existingLinks.data]);

  useEffect(() => {
    if (open && service && existingResourceLinks.data) {
      const record: Record<string, number> = {};
      for (const link of existingResourceLinks.data) {
        record[link.resource_id] = link.qty;
      }
      setSelectedResources(record);
    }
  }, [open, service, existingResourceLinks.data]);

  const isSaving =
    createService.isPending ||
    updateService.isPending ||
    setServiceProfessionals.isPending ||
    setServiceResources.isPending;

  async function onSubmit(values: ServiceInput) {
    try {
      // Sem entitlement, o bloco de depósito nunca viaja no request (strip
      // ADR-12 §4) — mesmo que o form tenha valor residual em memória.
      const payload = applyDepositEntitlement(values, depositoEntitled);
      const resourceLinks = Object.entries(selectedResources).map(
        ([resource_id, qty]) => ({ resource_id, qty: qty || 1 }),
      );
      if (service) {
        await updateService.mutateAsync({ id: service.id, ...payload });
        await setServiceProfessionals.mutateAsync(selectedProfessionals);
        await setServiceResources.mutateAsync(resourceLinks);
        toast.success("Serviço atualizado.");
      } else {
        const created = await createService.mutateAsync(payload);
        if (selectedProfessionals.length > 0) {
          await insertServiceProfessionals(created.id, selectedProfessionals);
        }
        if (resourceLinks.length > 0) {
          await insertServiceResources(created.id, resourceLinks);
        }
        toast.success("Serviço criado.");
      }
      onOpenChange(false);
    } catch {
      toast.error("Não foi possível salvar o serviço. Tente novamente.");
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Editar serviço" : "Novo serviço"}</DialogTitle>
          <DialogDescription>
            Defina nome, duração e preço. O preço é digitado em reais e guardado
            em centavos.
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
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Nome</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="Ex.: Consulta de avaliação"
                      autoComplete="off"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid gap-5 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="durationMinutes"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Duração (minutos)</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        inputMode="numeric"
                        min={1}
                        step={1}
                        value={Number.isFinite(field.value) ? field.value : ""}
                        onChange={(event) =>
                          field.onChange(event.target.valueAsNumber)
                        }
                        onBlur={field.onBlur}
                        name={field.name}
                        ref={field.ref}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="priceCents"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Preço</FormLabel>
                    <FormControl>
                      <MoneyInput
                        value={field.value}
                        onChange={field.onChange}
                        onBlur={field.onBlur}
                        name={field.name}
                        ref={field.ref}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="processingMinutes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Tempo de processamento (minutos)</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      inputMode="numeric"
                      min={0}
                      step={1}
                      value={Number.isFinite(field.value) ? field.value : ""}
                      onChange={(event) => field.onChange(event.target.valueAsNumber)}
                      onBlur={field.onBlur}
                      name={field.name}
                      ref={field.ref}
                    />
                  </FormControl>
                  <FormDescription>
                    Tempo após o atendimento (não bloqueia a agenda do profissional,
                    mas bloqueia o recurso vinculado).
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="backbarCostCents"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Custo de backbar (centavos)</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      inputMode="numeric"
                      min={0}
                      step={1}
                      value={Number.isFinite(field.value) ? field.value : ""}
                      onChange={(event) =>
                        field.onChange(event.target.valueAsNumber)
                      }
                      onBlur={field.onBlur}
                      name={field.name}
                      ref={field.ref}
                    />
                  </FormControl>
                  <FormDescription>
                    Custo de produtos consumidos no serviço (opcional). Usado na
                    comissão sobre margem.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="active"
              render={({ field }) => (
                <FormItem className="flex items-center justify-between rounded-md border border-border p-3">
                  <div className="space-y-0.5">
                    <FormLabel>Serviço ativo</FormLabel>
                    <FormDescription>
                      Serviços inativos não aparecem para novos agendamentos.
                    </FormDescription>
                  </div>
                  <FormControl>
                    <Switch
                      checked={field.value}
                      onCheckedChange={field.onChange}
                    />
                  </FormControl>
                </FormItem>
              )}
            />

            <ServiceProfessionalsField
              value={selectedProfessionals}
              onChange={setSelectedProfessionals}
              disabled={isSaving || (isEdit && existingLinks.isLoading)}
            />

            <DepositConfigSection
              entitled={entitlements === null ? null : depositoEntitled}
              value={depositValue}
              onChange={(next) =>
                form.setValue("deposit", next, {
                  shouldValidate: true,
                  shouldDirty: true,
                })
              }
              disabled={isSaving}
            />

            <fieldset className="space-y-2">
              <legend className="text-sm font-medium leading-none">
                Recursos vinculados
              </legend>
              <p className="text-sm text-muted-foreground">
                Marque os recursos (salas/equipamentos) usados por este serviço e a
                quantidade necessária.
              </p>
              {resourcesQuery.isLoading ? (
                <p className="text-sm text-muted-foreground">Carregando recursos…</p>
              ) : resourcesQuery.data && resourcesQuery.data.length > 0 ? (
                <div className="space-y-2 rounded-md border border-border p-3">
                  {resourcesQuery.data.map((resource) => {
                    const checked = Object.prototype.hasOwnProperty.call(
                      selectedResources,
                      resource.id,
                    );
                    return (
                      <div
                        key={resource.id}
                        className="flex items-center gap-3"
                      >
                        <input
                          type="checkbox"
                          id={`service-resource-${resource.id}`}
                          checked={checked}
                          disabled={isSaving}
                          onChange={(event) => {
                            setSelectedResources((prev) => {
                              const next = { ...prev };
                              if (event.target.checked) {
                                next[resource.id] = next[resource.id] ?? 1;
                              } else {
                                delete next[resource.id];
                              }
                              return next;
                            });
                          }}
                        />
                        <label
                          htmlFor={`service-resource-${resource.id}`}
                          className="flex-1 text-sm"
                        >
                          {resource.name}
                        </label>
                        {checked ? (
                          <Input
                            type="number"
                            min={1}
                            value={selectedResources[resource.id]}
                            onChange={(event) =>
                              setSelectedResources((prev) => ({
                                ...prev,
                                [resource.id]: Number(event.target.value) || 1,
                              }))
                            }
                            className="w-20"
                            aria-label={`Quantidade de ${resource.name}`}
                          />
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="rounded-md border border-dashed border-border p-3 text-sm text-muted-foreground">
                  Nenhum recurso ativo. Cadastre recursos para vinculá-los a
                  serviços.
                </p>
              )}
            </fieldset>

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
