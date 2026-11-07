import * as React from "react";
import { Wallet } from "lucide-react";

import { ClientConfirmedBadge } from "@/components/ClientConfirmedBadge";
import { ComboTag } from "@/components/ComboTag";
import { CommissionAmount } from "@/components/CommissionAmount";
import { StatusBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { PaymentStatusBadge } from "@/app/agenda/pagamentos/PaymentStatusBadge";
import { formatMessage } from "@/app/agenda/pagamentos/payments-messages";
import type { PaymentsMessages } from "@/app/agenda/pagamentos/payments-messages";
import type { AgendaPaymentFlag } from "@/hooks/useAgendaPaymentFlags";
import { cn } from "@/lib/utils";
import { formatTimeInTenantTz } from "@/lib/datetime";
import { serviceColorDotClass } from "@/lib/service-color";
import type {
  AppointmentStatus,
  AppointmentWithRelations,
} from "@/types/domain";

/**
 * Borda-lateral de status no calendário (mesmo mapa usado pela lista em
 * `AgendaPage`; reforço redundante do `StatusBadge`, nunca cor sozinha).
 */
export const STATUS_BORDER: Record<AppointmentStatus, string> = {
  pendente: "border-status-pendente",
  confirmado: "border-status-confirmado",
  em_atendimento: "border-status-em-atendimento",
  concluido: "border-status-concluido",
  cancelado: "border-status-cancelado",
  nao_compareceu: "border-status-nao-compareceu",
};

interface AppointmentBlockProps {
  appointment: AppointmentWithRelations;
  timeZone: string;
  /** `true` quando o bloco é muito baixo para caber serviço/profissional. */
  compact?: boolean;
  /** Pode exibir a linha de comissão (gating de segmento + RBAC resolvido no pai). */
  showCommission?: boolean;
  /** Abre o mesmo menu de ações da lista (editar/status/mensagem). */
  onOpen?: (appointment: AppointmentWithRelations) => void;
  /** Estado de pagamento derivado do servidor (ADR-004 §7). */
  paymentFlag?: AgendaPaymentFlag;
  /** Abre o settlement do atendimento (ação "Pagamento"). */
  onOpenPayment?: (appointment: AppointmentWithRelations) => void;
  /** Capacidade do cliente de registrar pagamentos (defesa em profundidade). */
  canRegisterPayments?: boolean;
  /** Catálogo de mensagens (selo/ação). Sem ele, o selo não é renderizado. */
  messages?: PaymentsMessages;
  className?: string;
  style?: React.CSSProperties;
}

/**
 * Bloco visual de um agendamento no calendário (dia/semana). Um `<button>`
 * principal abre o menu; a ação "Pagamento" (quando aplicável) é um botão
 * irmão — nunca aninhado — e não dispara `onOpen`.
 */
export function AppointmentBlock({
  appointment,
  timeZone,
  compact = false,
  showCommission = false,
  onOpen,
  paymentFlag,
  onOpenPayment,
  canRegisterPayments = false,
  messages,
  className,
  style,
}: AppointmentBlockProps) {
  const customerName = appointment.customers?.name ?? "Cliente removido";
  const isCombo = appointment.combo_id != null;
  const comboName = appointment.combos?.name ?? "Pacote removido";
  const serviceName = appointment.services?.name ?? "Serviço removido";
  const itemName = isCombo ? comboName : serviceName;
  const professionalName =
    appointment.professionals?.name ?? "Profissional removido";
  const startLabel = formatTimeInTenantTz(appointment.starts_at, timeZone);
  const endLabel = formatTimeInTenantTz(appointment.ends_at, timeZone);
  const confirmedByClient =
    appointment.status === "confirmado" &&
    appointment.confirmed_via === "cliente_whatsapp";

  const itemLabel = isCombo ? `Pacote: ${comboName}` : serviceName;
  const title =
    `${startLabel}–${endLabel} · ${customerName} · ${itemLabel} · ${professionalName}` +
    (confirmedByClient ? " · Confirmado pelo cliente no WhatsApp" : "");

  const showPaymentBadge =
    !!messages &&
    !!paymentFlag &&
    paymentFlag !== "unknown" &&
    paymentFlag !== "quitado" &&
    appointment.status === "concluido";
  const showPaymentAction =
    !!messages &&
    !!onOpenPayment &&
    canRegisterPayments &&
    (appointment.status === "em_atendimento" ||
      appointment.status === "concluido");

  return (
    <div className={cn("relative h-full", className)} style={style}>
      <button
        type="button"
        title={title}
        aria-label={`${customerName}, ${itemLabel} às ${startLabel}`}
        onClick={onOpen ? () => onOpen(appointment) : undefined}
        className={cn(
          "flex h-full w-full flex-col gap-0.5 overflow-hidden rounded-md border border-border border-l-2 bg-card p-2 text-left",
          "transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
          STATUS_BORDER[appointment.status],
        )}
      >
        <span className="flex items-center justify-between gap-1">
          <span className="min-w-0 truncate text-xs font-semibold tabular-nums text-foreground">
            {startLabel}
          </span>
          <span className="flex shrink-0 items-center gap-1">
            {!compact ? (
              <ClientConfirmedBadge appointment={appointment} />
            ) : null}
            <StatusBadge status={appointment.status} className="shrink-0" />
          </span>
        </span>
        <span className="min-w-0 truncate text-sm font-medium text-foreground">
          {customerName}
        </span>
        {!compact ? (
          <span className="flex items-center gap-1 truncate text-xs text-muted-foreground">
            <span
              aria-hidden="true"
              className={cn(
                "inline-block h-2 w-2 shrink-0 rounded-full",
                serviceColorDotClass(
                  appointment.combo_id ?? appointment.service_id,
                ),
              )}
            />
            <span className="truncate">
              {itemName}
              {" · "}
              {professionalName}
            </span>
            {isCombo ? <ComboTag /> : null}
          </span>
        ) : null}
        {showPaymentBadge && messages && paymentFlag ? (
          <PaymentStatusBadge
            status={paymentFlag}
            messages={messages}
            className="mt-0.5 w-fit max-w-full truncate text-[10px]"
          />
        ) : null}
        {!compact && showCommission && appointment.status === "concluido" ? (
          <CommissionAmount
            commissionCents={appointment.commission_cents}
            className="truncate text-xs"
          />
        ) : null}
      </button>

      {showPaymentAction && messages ? (
        <Button
          type="button"
          variant="secondary"
          size={compact ? "icon" : "sm"}
          aria-label={formatMessage(messages.agenda.actionPaymentAria, {
            cliente: customerName,
          })}
          onClick={(event) => {
            event.stopPropagation();
            onOpenPayment?.(appointment);
          }}
          className={
            compact
              ? "absolute bottom-0 right-0 z-10 h-11 w-11 min-h-[44px] min-w-[44px] p-0"
              : "absolute bottom-1 right-1 h-11 min-h-[44px] px-2 text-xs"
          }
        >
          {compact ? (
            <Wallet className="h-4 w-4" aria-hidden="true" />
          ) : (
            messages.agenda.actionPayment
          )}
        </Button>
      ) : null}
    </div>
  );
}
