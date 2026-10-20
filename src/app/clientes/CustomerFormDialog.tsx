import { useEffect } from "react";
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

import { customerSchema, type CustomerInput } from "@/lib/validations/scheduling";
import { useCreateCustomer, useUpdateCustomer } from "@/hooks/useCustomers";
import type { Customer } from "@/types/domain";

interface CustomerFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Cliente a editar; `null`/ausente cria um novo. */
  customer?: Customer | null;
}

// Valores de um cliente novo: opt-in nasce DESLIGADO (consentimento LGPD é
// ativo, nunca presumido).
const EMPTY_VALUES: CustomerInput = {
  name: "",
  phone: "",
  email: undefined,
  whatsappOptIn: false,
};

/**
 * Diálogo de criar/editar cliente (react-hook-form + `customerSchema`). O
 * telefone é digitado na forma br e normalizado para E.164 pelo schema no
 * submit; o `email` vazio vira `undefined`. O consentimento de WhatsApp
 * (`whatsapp_opt_in`, LGPD) é capturado por um `Switch` com copy explícita e
 * nasce desligado num cliente novo.
 */
export function CustomerFormDialog({
  open,
  onOpenChange,
  customer,
}: CustomerFormDialogProps) {
  const isEdit = !!customer;

  const createCustomer = useCreateCustomer();
  const updateCustomer = useUpdateCustomer();

  const form = useForm<CustomerInput>({
    resolver: zodResolver(customerSchema),
    defaultValues: EMPTY_VALUES,
  });

  // Ao (re)abrir, sincroniza o form com o cliente selecionado (ou valores novos).
  useEffect(() => {
    if (!open) return;
    if (customer) {
      form.reset({
        name: customer.name,
        phone: customer.phone,
        email: customer.email ?? undefined,
        whatsappOptIn: customer.whatsapp_opt_in,
      });
    } else {
      form.reset(EMPTY_VALUES);
    }
  }, [open, customer, form]);

  const isSaving = createCustomer.isPending || updateCustomer.isPending;

  async function onSubmit(values: CustomerInput) {
    try {
      if (customer) {
        await updateCustomer.mutateAsync({
          id: customer.id,
          name: values.name,
          phone: values.phone,
          email: values.email ?? null,
          whatsappOptIn: values.whatsappOptIn,
          // Edição não mexe no soft-delete; preserva o estado atual.
          active: customer.active,
        });
        toast.success("Cliente salvo.");
      } else {
        await createCustomer.mutateAsync({
          name: values.name,
          phone: values.phone,
          email: values.email ?? null,
          whatsappOptIn: values.whatsappOptIn,
          active: true,
        });
        toast.success("Cliente salvo.");
      }
      onOpenChange(false);
    } catch {
      toast.error("Não foi possível salvar o cliente. Tente novamente.");
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Editar cliente" : "Novo cliente"}</DialogTitle>
          <DialogDescription>
            Cadastre nome e telefone. O e-mail é opcional.
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
                      placeholder="Ex.: Maria Silva"
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
              name="phone"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Telefone</FormLabel>
                  <FormControl>
                    <Input
                      type="tel"
                      inputMode="tel"
                      placeholder="(11) 99999-8888"
                      autoComplete="off"
                      {...field}
                    />
                  </FormControl>
                  <FormDescription>
                    Com DDD. Assumimos o Brasil (+55) automaticamente. É o
                    número que recebe as mensagens de WhatsApp.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>E-mail (opcional)</FormLabel>
                  <FormControl>
                    <Input
                      type="email"
                      inputMode="email"
                      placeholder="maria@exemplo.com"
                      autoComplete="off"
                      value={field.value ?? ""}
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
              name="whatsappOptIn"
              render={({ field }) => (
                <FormItem className="flex items-center justify-between rounded-md border border-border p-3">
                  <div className="space-y-0.5 pr-4">
                    <FormLabel>Consentimento de WhatsApp</FormLabel>
                    <FormDescription>
                      O cliente autoriza receber confirmações, lembretes e
                      cobranças por WhatsApp. Só ative com a autorização dele.
                    </FormDescription>
                  </div>
                  <FormControl>
                    <Switch
                      checked={field.value}
                      onCheckedChange={field.onChange}
                      aria-label="Autorizar mensagens por WhatsApp"
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
