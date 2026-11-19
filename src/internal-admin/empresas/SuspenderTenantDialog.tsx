import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
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
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

import { BACKOFFICE_STATUS_AUDIT_KEY } from "@/internal-admin/backoffice/useBackoffice";
import { useChangeSubscriptionStatus } from "@/hooks/useAdminTenants";
import { mapSubscriptionError } from "@/lib/subscription-errors";
import {
  backofficeStatusFormSchema,
  REASON_MAX_LENGTH,
  type BackofficeStatusFormValues,
} from "@/lib/validations/backoffice";
import type { SubscriptionStatus, TenantListItem } from "@/types/domain";

/** Ação possível sobre a assinatura SaaS da empresa. */
export type SuspensaoAcao = "suspender" | "retomar";

/** Status destino de cada ação (máquina canônica do servidor: ativo↔bloqueado). */
const ACAO_DESTINO: Record<SuspensaoAcao, SubscriptionStatus> = {
  suspender: "bloqueado",
  retomar: "ativo",
};

/** A ação só é oferecida quando a transição é válida no servidor. */
export function isAcaoPermitida(
  acao: SuspensaoAcao,
  status: SubscriptionStatus,
): boolean {
  return acao === "suspender"
    ? status === "ativo" || status === "pendente"
    : status === "bloqueado";
}

function displayName(tenant: TenantListItem): string {
  const trade = tenant.trade_name?.trim();
  return trade && trade.length > 0 ? trade : tenant.legal_name;
}

const COPY: Record<
  SuspensaoAcao,
  { trigger: string; titulo: string; descricao: string; confirmar: string }
> = {
  suspender: {
    trigger: "Suspender",
    titulo: "Suspender empresa",
    descricao:
      "A empresa passa para bloqueado: o app redireciona para a tela de quitação e a escrita operacional fica bloqueada. A ação é registrada com autor e motivo.",
    confirmar: "Suspender empresa",
  },
  retomar: {
    trigger: "Retomar",
    titulo: "Retomar empresa",
    descricao:
      "A empresa volta para ativo e o acesso operacional é restaurado. A ação é registrada com autor e motivo.",
    confirmar: "Retomar empresa",
  },
};

interface SuspenderTenantDialogProps {
  tenant: TenantListItem;
  acao: SuspensaoAcao;
}

/**
 * Suspender/retomar empresa (ADR-11, RF-33). **Motivo obrigatório** (zod) e
 * nenhuma escrita direta: a operação passa pela Edge Function
 * `admin-subscription` (JWT é a credencial; `tenantId` é o alvo) que valida a
 * transição e grava a trilha atômica em `subscription_status_changes`.
 *
 * Erros mantêm o dialog aberto com mensagem pt-BR em `role="alert"`; a lista
 * não é invalidada em falha (estado não mudou).
 */
export function SuspenderTenantDialog({
  tenant,
  acao,
}: SuspenderTenantDialogProps) {
  const [open, setOpen] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const changeStatus = useChangeSubscriptionStatus();
  const copy = COPY[acao];

  const form = useForm<BackofficeStatusFormValues>({
    resolver: zodResolver(backofficeStatusFormSchema),
    defaultValues: { reason: "" },
  });

  useEffect(() => {
    if (open) {
      form.reset({ reason: "" });
      setSubmitError(null);
    }
  }, [open, form]);

  const permitida = isAcaoPermitida(acao, tenant.subscription_status);

  async function onSubmit(values: BackofficeStatusFormValues) {
    setSubmitError(null);
    try {
      await changeStatus.mutateAsync({
        tenantId: tenant.id,
        status: ACAO_DESTINO[acao],
        reason: values.reason.trim(),
      });
      void queryClient.invalidateQueries({
        queryKey: BACKOFFICE_STATUS_AUDIT_KEY,
      });
      toast.success(
        acao === "suspender"
          ? "Empresa suspensa."
          : "Empresa reativada.",
      );
      setOpen(false);
    } catch (error) {
      setSubmitError(mapSubscriptionError(error));
    }
  }

  const isSaving = changeStatus.isPending;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          type="button"
          variant={acao === "suspender" ? "destructive" : "outline"}
          size="sm"
          disabled={!permitida}
          title={
            permitida
              ? undefined
              : `Ação indisponível para o status atual (${tenant.subscription_status}).`
          }
        >
          {copy.trigger}
        </Button>
      </DialogTrigger>

      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {copy.titulo} — {displayName(tenant)}
          </DialogTitle>
          <DialogDescription>{copy.descricao}</DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(onSubmit)}
            className="space-y-5"
            noValidate
          >
            <FormField
              control={form.control}
              name="reason"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Motivo (obrigatório)</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="Ex.: inadimplência confirmada pelo financeiro."
                      maxLength={REASON_MAX_LENGTH}
                      {...field}
                    />
                  </FormControl>
                  <FormDescription>
                    Até {REASON_MAX_LENGTH} caracteres. Fica registrado na
                    auditoria com o seu usuário.
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
              <Button
                type="submit"
                variant={acao === "suspender" ? "destructive" : "default"}
                disabled={isSaving}
              >
                {isSaving ? (
                  <>
                    <Loader2 className="animate-spin" aria-hidden="true" />
                    Salvando…
                  </>
                ) : (
                  copy.confirmar
                )}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
