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
  DialogTrigger,
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

import { useChangeSubscriptionStatus } from "@/hooks/useAdminTenants";
import { mapSubscriptionError } from "@/lib/subscription-errors";
import {
  getAllowedSubscriptionTransitions,
  getSubscriptionTransitionLabel,
} from "@/lib/subscription-status";
import {
  changeStatusFormSchema,
  type ChangeStatusFormValues,
} from "@/lib/validations/admin-subscription";
import type { SubscriptionStatus, TenantListItem } from "@/types/domain";

/** Limite do motivo (espelha a validação zod do `changeStatusFormSchema`). */
const REASON_MAX_LENGTH = 280;

/** Nome exibido no título: fantasia quando houver, senão razão social. */
function displayName(tenant: TenantListItem): string {
  const trade = tenant.trade_name?.trim();
  return trade && trade.length > 0 ? trade : tenant.legal_name;
}

interface MudarStatusDialogProps {
  tenant: TenantListItem;
}

/**
 * Ação "Mudar status" por empresa (ADR-07): um gatilho abre um dialog com
 * react-hook-form + zod para o super_admin escolher um `subscription_status`
 * destino (+ motivo opcional ≤280) e consumir a Edge Function `admin-subscription`
 * via `useChangeSubscriptionStatus`.
 *
 * Segurança/contrato: a escrita de status **só** passa pela Edge Function (o
 * `tenantId` vai como alvo, nunca como credencial — o JWT do super_admin é a
 * credencial, validada no servidor). Não há UPDATE direto de
 * `tenants.subscription_status` pelo cliente nesta tela.
 *
 * O select só oferece as transições válidas (`getAllowedSubscriptionTransitions`,
 * fonte única espelhando o servidor) — defesa de **usabilidade**; a trava
 * canônica é o servidor (ADR-03), que recusa transição inválida de qualquer
 * forma. Em sucesso: toast pt-BR, fecha, a mutation invalida a lista (badge novo
 * sem reload). Em falha: mantém o dialog aberto com a mensagem pt-BR mapeada em
 * `role="alert"` e **não** muda a lista.
 */
export function MudarStatusDialog({ tenant }: MudarStatusDialogProps) {
  const [open, setOpen] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const changeStatus = useChangeSubscriptionStatus();

  const allowedTransitions = getAllowedSubscriptionTransitions(
    tenant.subscription_status,
  );
  const hasTransitions = allowedTransitions.length > 0;

  const form = useForm<ChangeStatusFormValues>({
    resolver: zodResolver(changeStatusFormSchema),
    defaultValues: { reason: "" },
  });

  // Ao (re)abrir, limpa o form e qualquer erro anterior — o destino começa sem
  // seleção para o super_admin escolher conscientemente.
  useEffect(() => {
    if (open) {
      form.reset({ reason: "" });
      setSubmitError(null);
    }
  }, [open, form]);

  async function onSubmit(values: ChangeStatusFormValues) {
    setSubmitError(null);
    try {
      await changeStatus.mutateAsync({
        tenantId: tenant.id,
        status: values.status,
        reason: values.reason?.trim() ? values.reason.trim() : undefined,
      });
      // Sucesso: a mutation invalida a lista (badge novo sem reload — R-05/CA-05).
      toast.success("Assinatura atualizada.");
      setOpen(false);
    } catch (error) {
      // Falha: dialog continua aberto, mensagem pt-BR em role="alert", lista
      // inalterada (a mutation não invalida em erro) — R-07/CA-07.
      setSubmitError(mapSubscriptionError(error));
    }
  }

  const isSaving = changeStatus.isPending;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!hasTransitions}
          title={
            hasTransitions
              ? undefined
              : "Nenhuma transição de status disponível para esta empresa."
          }
        >
          Mudar status
        </Button>
      </DialogTrigger>

      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Alterar assinatura — {displayName(tenant)}</DialogTitle>
          <DialogDescription>
            Escolha o novo status da assinatura. A mudança é registrada e
            aplicada por um canal auditado.
          </DialogDescription>
        </DialogHeader>

        {hasTransitions ? (
          <Form {...form}>
            <form
              onSubmit={form.handleSubmit(onSubmit)}
              className="space-y-5"
              noValidate
            >
              <FormField
                control={form.control}
                name="status"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Novo status</FormLabel>
                    <Select
                      value={field.value}
                      onValueChange={(value) =>
                        field.onChange(value as SubscriptionStatus)
                      }
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Selecione o status destino" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {allowedTransitions.map((status) => (
                          <SelectItem key={status} value={status}>
                            {getSubscriptionTransitionLabel(status)}
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
                name="reason"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Motivo (opcional)</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder="Ex.: inadimplência confirmada pelo financeiro."
                        maxLength={REASON_MAX_LENGTH}
                        {...field}
                        value={field.value ?? ""}
                      />
                    </FormControl>
                    <FormDescription>
                      Até {REASON_MAX_LENGTH} caracteres. Fica registrado na
                      auditoria da mudança.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {submitError ? (
                <p
                  role="alert"
                  className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm font-medium text-destructive"
                >
                  {submitError}
                </p>
              ) : null}

              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setOpen(false)}
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
                    "Salvar alteração"
                  )}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        ) : (
          <p className="text-sm text-muted-foreground">
            Nenhuma transição de status disponível para esta empresa.
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
