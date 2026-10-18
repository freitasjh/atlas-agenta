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

import { serviceSchema, type ServiceInput } from "@/lib/validations/catalog";
import { useCreateService, useUpdateService } from "@/hooks/useServices";
import {
  insertServiceProfessionals,
  useServiceProfessionals,
  useSetServiceProfessionals,
} from "@/hooks/useServiceProfessionals";
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
  priceCents: 0,
  active: true,
};

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

  const [selectedProfessionals, setSelectedProfessionals] = useState<string[]>(
    [],
  );

  const form = useForm<ServiceInput>({
    resolver: zodResolver(serviceSchema),
    defaultValues: EMPTY_VALUES,
  });

  // Ao (re)abrir, sincroniza o form com o serviço selecionado (ou valores novos).
  useEffect(() => {
    if (!open) return;
    if (service) {
      form.reset({
        name: service.name,
        durationMinutes: service.duration_minutes,
        priceCents: service.price_cents,
        active: service.active,
      });
    } else {
      form.reset(EMPTY_VALUES);
      setSelectedProfessionals([]);
    }
  }, [open, service, form]);

  // No modo edição, popular a seleção N:N quando os vínculos carregarem.
  useEffect(() => {
    if (open && service && existingLinks.data) {
      setSelectedProfessionals(existingLinks.data);
    }
  }, [open, service, existingLinks.data]);

  const isSaving =
    createService.isPending ||
    updateService.isPending ||
    setServiceProfessionals.isPending;

  async function onSubmit(values: ServiceInput) {
    try {
      if (service) {
        await updateService.mutateAsync({ id: service.id, ...values });
        await setServiceProfessionals.mutateAsync(selectedProfessionals);
        toast.success("Serviço atualizado.");
      } else {
        const created = await createService.mutateAsync(values);
        if (selectedProfessionals.length > 0) {
          await insertServiceProfessionals(created.id, selectedProfessionals);
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
