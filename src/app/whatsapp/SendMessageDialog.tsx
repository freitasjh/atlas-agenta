import { Fragment, useEffect, useMemo } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import { Link } from "react-router-dom";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { useSendMessage } from "@/hooks/useMessages";
import { useMessageTemplates } from "@/hooks/useMessageTemplates";
import { useTenant } from "@/hooks/useTenant";
import { mapSendOutcome, mapWhatsAppError } from "@/lib/whatsapp-errors";
import { getMessageTemplateLabel } from "@/lib/whatsapp";
import {
  TEMPLATE_FALLBACKS,
  TEMPLATE_VARIABLES,
  type TemplateVariable,
  type TemplateVars,
} from "@/lib/message-templates";
import { cn } from "@/lib/utils";
import {
  sendMessageSchema,
  type SendMessageInput,
} from "@/lib/validations/whatsapp";

const KNOWN_VARIABLES = new Set<string>(TEMPLATE_VARIABLES);
const TOKEN_PATTERN = /\{([a-zA-Z][a-zA-Z0-9_]*)\}/g;

type PreviewSegment =
  | { kind: "text"; value: string }
  | { kind: "var"; value: string };

/**
 * Segmenta o corpo do template em texto literal e variáveis resolvidas,
 * aplicando a MESMA tabela de fallback de `renderTemplate` (ADR-03). Token
 * desconhecido fica literal; variável conhecida nunca aparece crua. Espelha a
 * semântica canônica preservando quais trechos foram substituídos (realce por
 * fundo), igual ao preview do editor (ADR-06). O preview é defesa em
 * profundidade — a renderização de fio é do servidor (ADR-04).
 */
function segmentPreview(body: string, vars: TemplateVars): PreviewSegment[] {
  const segments: PreviewSegment[] = [];
  let lastIndex = 0;
  for (const match of body.matchAll(TOKEN_PATTERN)) {
    const [raw, name] = match;
    const start = match.index ?? 0;
    if (!KNOWN_VARIABLES.has(name)) {
      // Token desconhecido: mantém literal (parte do texto comum).
      continue;
    }
    if (start > lastIndex) {
      segments.push({ kind: "text", value: body.slice(lastIndex, start) });
    }
    const variable = name as TemplateVariable;
    const value = vars[variable];
    const resolved =
      value != null && value.trim() !== ""
        ? value
        : TEMPLATE_FALLBACKS[variable];
    segments.push({ kind: "var", value: resolved });
    lastIndex = start + raw.length;
  }
  if (lastIndex < body.length) {
    segments.push({ kind: "text", value: body.slice(lastIndex) });
  }
  return segments;
}

interface SendMessageDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Cliente destino (vínculo pelo id; sem PII renderizada). */
  customerId: string;
  /** Nome do cliente, só para a copy do diálogo. */
  customerName: string;
  /** Consentimento LGPD. `false` desabilita o envio na borda (defesa dupla). */
  whatsappOptIn: boolean;
  /** Agendamento de origem, quando disparado a partir da Agenda. */
  appointmentId?: string;
}

/**
 * Diálogo de envio de mensagem sob demanda, reusado por Agenda e Clientes
 * (ADR-08). Escolhe um template (default `confirmacao`), confirma e invoca a
 * Edge Function `whatsapp` via `useSendMessage`. Segue o esqueleto do
 * `StatusChangeConfirm` (confirmação + `isPending` com `Loader2` + `toast` +
 * mapa de erro) e o padrão react-hook-form + zod + shadcn das demais telas.
 *
 * A trava real do opt-in e da idempotência é o servidor (ADR-04); aqui o
 * opt-in é **defesa em profundidade**: quando `whatsappOptIn === false` o envio
 * fica desabilitado com explicação pt-BR e atalho para editar o consentimento
 * em Clientes. O cliente nunca envia `tenant_id` (derivado do JWT no servidor);
 * o corpo leva só `template`/`customerId`/`appointmentId?`.
 *
 * Resultados (`SendResponse.outcome`):
 *  - `sent` → toast de sucesso e fecha; o histórico é invalidado pelo hook.
 *  - `duplicate` → toast **informativo** (no-op benigno da idempotência) e fecha.
 *  - `opt_out`/`not_connected`/`send_failed` → toast com a mensagem pt-BR do
 *    mapa; `not_connected` oferece atalho para a tela de conexão.
 */
export function SendMessageDialog({
  open,
  onOpenChange,
  customerId,
  customerName,
  whatsappOptIn,
  appointmentId,
}: SendMessageDialogProps) {
  const sendMessage = useSendMessage();
  const templatesQuery = useMessageTemplates();
  const tenantQuery = useTenant();

  const form = useForm<SendMessageInput>({
    resolver: zodResolver(sendMessageSchema),
    defaultValues: {
      template: "confirmacao",
      customerId,
      appointmentId,
    },
  });

  // Ao (re)abrir, ressincroniza o destino e volta o template ao default.
  useEffect(() => {
    if (!open) return;
    form.reset({
      template: "confirmacao",
      customerId,
      appointmentId,
    });
  }, [open, customerId, appointmentId, form]);

  const selectedTemplate = form.watch("template");

  // Só os templates ATIVOS do tenant são oferecidos (defesa em profundidade; a
  // trava final de ativo/inativo é do servidor, ADR-04). Mantém a ordem
  // canônica de `MessageTemplate` para a UI ficar estável.
  const activeTemplates = useMemo(
    () => (templatesQuery.data ?? []).filter((row) => row.active),
    [templatesQuery.data],
  );

  const selectedRow = useMemo(
    () => activeTemplates.find((row) => row.template_key === selectedTemplate),
    [activeTemplates, selectedTemplate],
  );

  // Dados disponíveis no diálogo para o preview: `{nome}` = nome do cliente,
  // `{empresa}` = nome fantasia do tenant. `{servico}`/`{dataHora}` não vêm no
  // diálogo (só o `appointmentId`); caem no fallback pt-BR, deixando explícito
  // ao admin que não haverá dado cru. A renderização de fio é do servidor.
  const previewVars = useMemo<TemplateVars>(
    () => ({
      nome: customerName,
      empresa: tenantQuery.data?.trade_name ?? null,
    }),
    [customerName, tenantQuery.data?.trade_name],
  );

  const previewSegments = useMemo(
    () =>
      selectedRow ? segmentPreview(selectedRow.body, previewVars) : [],
    [selectedRow, previewVars],
  );

  // Envio bloqueado na borda quando o template escolhido não tem versão ativa
  // para o tenant (sem seed / desativado). O servidor é a trava real.
  const templatesLoaded = !templatesQuery.isLoading && !templatesQuery.isError;
  const noActiveTemplate =
    whatsappOptIn && templatesLoaded && !selectedRow;

  async function onSubmit(values: SendMessageInput) {
    try {
      const result = await sendMessage.mutateAsync(values);
      const message = mapSendOutcome(result.outcome);

      if (result.outcome === "sent") {
        toast.success(message);
        onOpenChange(false);
        return;
      }
      if (result.outcome === "duplicate") {
        // Idempotência: nada novo foi enviado — informativo, não é erro.
        toast.info(message);
        onOpenChange(false);
        return;
      }
      if (result.outcome === "not_connected") {
        toast.error(message, {
          action: {
            label: "Conectar",
            onClick: () => {
              window.location.href = "/app/config/whatsapp";
            },
          },
        });
        return;
      }
      // `opt_out` / `send_failed`: bloqueio/falha definidos — a UI não fecha,
      // deixa o motivo visível e o retry seguro (idempotência no servidor).
      toast.error(message);
    } catch (error) {
      // Erro de infra/auth: mensagem pt-BR sem vazar schema nem PII.
      toast.error(mapWhatsAppError(error));
    }
  }

  const sendDisabled =
    !whatsappOptIn || noActiveTemplate || sendMessage.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Enviar mensagem por WhatsApp</DialogTitle>
          <DialogDescription>
            {`Escolha o modelo da mensagem a enviar para ${customerName}.`}
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
              name="template"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Modelo</FormLabel>
                  <Select
                    value={field.value}
                    onValueChange={field.onChange}
                    disabled={!whatsappOptIn}
                  >
                    <FormControl>
                      <SelectTrigger aria-label="Modelo de mensagem">
                        <SelectValue placeholder="Selecione o modelo" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {activeTemplates.map((row) => (
                        <SelectItem
                          key={row.template_key}
                          value={row.template_key}
                        >
                          {getMessageTemplateLabel(row.template_key)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormDescription>
                    A mensagem é enviada pelo número de WhatsApp conectado da
                    empresa.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Preview: o texto renderizado que o cliente receberá. É só camada
                de confiança — a renderização real é do servidor (ADR-04). */}
            {whatsappOptIn && selectedRow ? (
              <div className="space-y-1.5">
                <p className="text-xs font-medium text-muted-foreground">
                  Prévia da mensagem
                </p>
                <div
                  aria-live="polite"
                  className="min-h-[72px] whitespace-pre-wrap break-words rounded-md border border-border bg-muted/40 p-3 text-sm text-foreground"
                >
                  {previewSegments.map((segment, index) =>
                    segment.kind === "var" ? (
                      <span
                        key={index}
                        className={cn(
                          "rounded bg-primary/15 px-1 font-medium text-foreground",
                        )}
                      >
                        {segment.value}
                      </span>
                    ) : (
                      <Fragment key={index}>{segment.value}</Fragment>
                    ),
                  )}
                </div>
              </div>
            ) : null}

            {noActiveTemplate ? (
              // Sem template ativo para a chave (sem seed / desativado): envio
              // bloqueado na borda com motivo pt-BR e atalho para a edição. A
              // trava real continua no servidor.
              <p
                className="rounded-md border border-border bg-muted/40 p-3 text-sm text-muted-foreground"
                role="note"
              >
                Nenhum modelo ativo para esta mensagem. Ajuste em{" "}
                <Link
                  to="/app/config/mensagens"
                  className="font-medium text-foreground underline underline-offset-4"
                >
                  Modelos de mensagem
                </Link>
                .
              </p>
            ) : null}

            {!whatsappOptIn ? (
              // Opt-in na borda: envio desabilitado, motivo em texto (não só
              // `disabled`) e atalho para editar o consentimento em Clientes.
              <p
                className="rounded-md border border-border bg-muted/40 p-3 text-sm text-muted-foreground"
                role="note"
              >
                Este cliente não autorizou receber mensagens no WhatsApp. Ajuste
                o consentimento em{" "}
                <Link
                  to="/app/clientes"
                  className="font-medium text-foreground underline underline-offset-4"
                >
                  Clientes
                </Link>
                .
              </p>
            ) : null}

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={sendMessage.isPending}
              >
                Cancelar
              </Button>
              <Button type="submit" disabled={sendDisabled}>
                {sendMessage.isPending ? (
                  <>
                    <Loader2 className="animate-spin" aria-hidden="true" />
                    Enviando…
                  </>
                ) : (
                  "Enviar"
                )}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
