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
} from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";

import { TemplateBodyField } from "@/app/config/mensagens/TemplateBodyField";
import { TemplatePreview } from "@/app/config/mensagens/TemplatePreview";
import {
  messageTemplateSchema,
  type MessageTemplateInput,
} from "@/lib/validations/whatsapp";
import { useUpsertMessageTemplate } from "@/hooks/useMessageTemplates";
import { getMessageTemplateLabel } from "@/lib/whatsapp";
import { useTenant } from "@/hooks/useTenant";
import type { MessageTemplate } from "@/types/domain";

interface TemplateEditorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Chave do template em edição (domínio fechado, read-only no form). */
  templateKey: MessageTemplate;
  /** Corpo atual (do banco ou default "a configurar"). */
  body: string;
  /** Estado ativo atual. */
  active: boolean;
}

/**
 * Diálogo de edição de um dos 4 modelos (rhf + `messageTemplateSchema`). A chave
 * é read-only (domínio fechado); edita-se corpo e `ativo`. Mostra o preview ao
 * vivo derivado de `body`. Em sucesso: toast, fecha e invalida o cache (hook).
 * Espelha `ServiceFormDialog`.
 */
export function TemplateEditorDialog({
  open,
  onOpenChange,
  templateKey,
  body,
  active,
}: TemplateEditorDialogProps) {
  const upsert = useUpsertMessageTemplate();
  const tenantQuery = useTenant();
  const empresa = tenantQuery.data?.trade_name ?? null;
  const legalName = tenantQuery.data?.legal_name ?? null;

  const form = useForm<MessageTemplateInput>({
    resolver: zodResolver(messageTemplateSchema),
    defaultValues: { templateKey, body, active },
  });

  // Ao (re)abrir, sincroniza o form com o template selecionado.
  useEffect(() => {
    if (!open) return;
    form.reset({ templateKey, body, active });
  }, [open, templateKey, body, active, form]);

  const watchedBody = form.watch("body");

  async function onSubmit(values: MessageTemplateInput) {
    try {
      await upsert.mutateAsync(values);
      toast.success("Modelo atualizado.");
      onOpenChange(false);
    } catch {
      toast.error("Não foi possível salvar o modelo. Tente novamente.");
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            Editar modelo: {getMessageTemplateLabel(templateKey)}
          </DialogTitle>
          <DialogDescription>
            Este é o texto que seus clientes recebem no WhatsApp.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(onSubmit)}
            className="space-y-5"
            noValidate
          >
            <TemplateBodyField control={form.control} disabled={upsert.isPending} />

            <TemplatePreview
              body={watchedBody}
              empresa={empresa}
              legalName={legalName}
            />

            <FormField
              control={form.control}
              name="active"
              render={({ field }) => (
                <FormItem className="flex items-center justify-between rounded-md border border-border p-3">
                  <div className="space-y-0.5">
                    <FormLabel>Modelo ativo</FormLabel>
                    <FormDescription>
                      Modelos inativos não são enviados aos clientes.
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
                disabled={upsert.isPending}
              >
                Cancelar
              </Button>
              <Button type="submit" disabled={upsert.isPending}>
                {upsert.isPending ? (
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
