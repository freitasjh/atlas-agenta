import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatCentsToBRL } from "@/lib/money";
import { formatDateInTenantTz, formatTimeInTenantTz } from "@/lib/datetime";
import { formatMessage, type PaymentsMessages } from "./payments-messages";
import type { SettlementPayment } from "@/types/payments";

export interface SettlementPaymentRowProps {
  payment: SettlementPayment;
  canVoid: boolean;
  onVoidRequest: (payment: SettlementPayment) => void;
  messages: PaymentsMessages;
  timeZone: string;
}

/**
 * Linha de recebimento do settlement (ADR-004 §5.3.8). Estornada é atenuada +
 * riscada **e** diz "Estornada"; o motivo só aparece quando o servidor envia
 * (recorte admin).
 */
export function SettlementPaymentRow({
  payment,
  canVoid,
  onVoidRequest,
  messages,
  timeZone,
}: SettlementPaymentRowProps) {
  const voided = payment.voided_at !== null;
  const received = `${formatDateInTenantTz(payment.received_at, timeZone)} ${formatTimeInTenantTz(
    payment.received_at,
    timeZone,
  )}`;
  const origin =
    payment.source === "asaas"
      ? messages.settlement.originAsaas
      : messages.settlement.originManual;

  return (
    <li
      data-testid={`settlement-payment-${payment.id}`}
      className={cn(
        "space-y-1 rounded-md border border-border bg-card p-3",
        voided && "opacity-70",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span
          className={cn(
            "text-sm font-medium text-foreground",
            voided && "line-through",
          )}
        >
          {messages.method[payment.method]}
        </span>
        <span className="font-mono text-sm tabular-nums text-foreground">
          {formatCentsToBRL(payment.amount_cents)}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span>{origin}</span>
        <span aria-hidden="true">·</span>
        <span className="tabular-nums">{received}</span>
        {payment.tip_cents > 0 ? (
          <>
            <span aria-hidden="true">·</span>
            <span>
              {messages.settlement.tip} {formatCentsToBRL(payment.tip_cents)}
            </span>
          </>
        ) : null}
      </div>

      {voided ? (
        <p className="text-xs font-medium text-destructive">
          {messages.settlement.voided}
          {payment.void_reason
            ? ` — ${formatMessage(messages.settlement.voidReason, {
                motivo: payment.void_reason,
              })}`
            : null}
        </p>
      ) : null}

      {canVoid && !voided ? (
        <Button
          type="button"
          variant="destructive"
          size="sm"
          onClick={() => onVoidRequest(payment)}
          className="h-11 min-h-[44px]"
        >
          {messages.void.title}
        </Button>
      ) : null}
    </li>
  );
}
