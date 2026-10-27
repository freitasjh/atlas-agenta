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
import { ComboServicesField } from "@/app/config/combos/ComboServicesField";

import { comboSchema, type ComboInput } from "@/lib/validations/catalog";
import { useCreateCombo, useUpdateCombo } from "@/hooks/useCombos";
import { useComboServices } from "@/hooks/useComboServices";
import { useServices } from "@/hooks/useServices";
import { formatCentsToBRL } from "@/lib/money";
import type { Combo } from "@/types/domain";

interface ComboFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Pacote a editar; `null`/ausente cria um novo. */
  combo?: Combo | null;
}

const EMPTY_VALUES: ComboInput = {
  name: "",
  priceCents: 0,
  serviceIds: [],
  active: true,
};

/**
 * Diálogo de criar/editar pacote (react-hook-form + `comboSchema`). Espelha o
 * `ServiceFormDialog` + N:N: o preço do pacote é digitado em R$ via `MoneyInput`
 * e trafega em centavos (RF-S13). A seleção N:N de serviços é editada aqui pelo
 * `ComboServicesField`; no modo edição o estado inicial vem de
 * `useComboServices(comboId)`, e ao salvar o diff é aplicado via `useUpdateCombo`
 * (que chama `setComboServices`). Num pacote novo, `useCreateCombo` grava a linha
 * e insere os vínculos (a FK composta exige o combo já criado).
 *
 * O rodapé é read-only e informativo: soma das durações e soma dos preços de
 * referência dos serviços selecionados, ao lado do preço do pacote — ajuda o
 * lojista a enxergar o "desconto". O valor que vale é o `priceCents` do pacote
 * (D-2); a soma dos serviços é só referência.
 */
export function ComboFormDialog({
  open,
  onOpenChange,
  combo,
}: ComboFormDialogProps) {
  const isEdit = !!combo;

  const createCombo = useCreateCombo();
  const updateCombo = useUpdateCombo();

  const existingLinks = useComboServices(combo?.id ?? null);
  const servicesQuery = useServices({ activeOnly: true });

  const form = useForm<ComboInput>({
    resolver: zodResolver(comboSchema),
    defaultValues: EMPTY_VALUES,
  });

  // Fonte de verdade da seleção N:N: o campo `serviceIds` do próprio form.
  const selectedServiceIds = form.watch("serviceIds");
  const packagePrice = form.watch("priceCents");

  // Ao (re)abrir, sincroniza o form com o pacote selecionado (ou valores novos).
  useEffect(() => {
    if (!open) return;
    if (combo) {
      form.reset({
        name: combo.name,
        priceCents: combo.price_cents,
        serviceIds: [],
        active: combo.active,
      });
    } else {
      form.reset(EMPTY_VALUES);
    }
  }, [open, combo, form]);

  // No modo edição, popular a seleção N:N quando os vínculos carregarem.
  useEffect(() => {
    if (open && combo && existingLinks.data) {
      form.setValue("serviceIds", existingLinks.data, {
        shouldValidate: false,
      });
    }
  }, [open, combo, existingLinks.data, form]);

  // Soma de referência (duração e preço) dos serviços selecionados — informativo.
  const reference = useMemo(() => {
    const services = servicesQuery.data ?? [];
    const selected = new Set(selectedServiceIds);
    return (services ?? []).reduce(
      (acc, service) => {
        if (!selected.has(service.id)) return acc;
        return {
          durationMinutes: acc.durationMinutes + service.duration_minutes,
          priceCents: acc.priceCents + service.price_cents,
        };
      },
      { durationMinutes: 0, priceCents: 0 },
    );
  }, [servicesQuery.data, selectedServiceIds]);

  const isSaving = createCombo.isPending || updateCombo.isPending;

  async function onSubmit(values: ComboInput) {
    try {
      if (combo) {
        await updateCombo.mutateAsync({ id: combo.id, ...values });
        toast.success("Pacote atualizado.");
      } else {
        await createCombo.mutateAsync(values);
        toast.success("Pacote criado.");
      }
      onOpenChange(false);
    } catch {
      toast.error("Não foi possível salvar o pacote. Tente novamente.");
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Editar pacote" : "Novo pacote"}</DialogTitle>
          <DialogDescription>
            Combine serviços num preço fechado. O preço é digitado em reais e
            guardado em centavos.
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
                      placeholder="Ex.: Dia da noiva"
                      autoComplete="off"
                      {...field}
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
                  <FormLabel>Preço do pacote</FormLabel>
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

            <FormField
              control={form.control}
              name="serviceIds"
              render={({ field }) => (
                <FormItem>
                  <ComboServicesField
                    value={field.value}
                    onChange={field.onChange}
                    disabled={isSaving || (isEdit && existingLinks.isLoading)}
                  />
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Rodapé informativo: referência vs. preço do pacote (read-only). */}
            <dl className="grid gap-2 rounded-md border border-border p-3 text-sm sm:grid-cols-3">
              <div>
                <dt className="text-muted-foreground">Duração somada</dt>
                <dd className="font-medium text-foreground">
                  {reference.durationMinutes} min
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Preços avulsos</dt>
                <dd className="font-medium text-foreground">
                  {formatCentsToBRL(reference.priceCents)}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Preço do pacote</dt>
                <dd className="font-medium text-foreground">
                  {formatCentsToBRL(packagePrice)}
                </dd>
              </div>
            </dl>

            <FormField
              control={form.control}
              name="active"
              render={({ field }) => (
                <FormItem className="flex items-center justify-between rounded-md border border-border p-3">
                  <div className="space-y-0.5">
                    <FormLabel>Pacote ativo</FormLabel>
                    <FormDescription>
                      Pacotes inativos não aparecem para novos agendamentos.
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
