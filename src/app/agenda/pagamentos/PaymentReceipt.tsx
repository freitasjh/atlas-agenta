import { useId } from "react";

import { formatCentsToBRL } from "@/lib/money";
import { formatDateInTenantTz, formatTimeInTenantTz } from "@/lib/datetime";
import type { PaymentsMessages } from "./payments-messages";
import type { ReceiptData } from "./payment-types";

export interface PaymentReceiptProps {
  data: ReceiptData;
  timeZone: string;
  messages: PaymentsMessages;
}

/**
 * Comprovante operacional (ADR-004 §5.3.6). Sem QR, copia-e-cola, token, id de
 * gateway ou dado de cartão. Troco só quando calculado nesta sessão.
 */
export function PaymentReceipt({ data, timeZone, messages }: PaymentReceiptProps) {
  const titleId = useId();
  const dateLabel = `${formatDateInTenantTz(data.issuedAt, timeZone)} ${formatTimeInTenantTz(
    data.issuedAt,
    timeZone,
  )}`;

  return (
    <article
      data-testid="payment-receipt"
      aria-labelledby={titleId}
      className="space-y-3 rounded-md border border-border bg-card p-4"
    >
      <header className="space-y-1">
        <h3 id={titleId} className="font-display text-base font-semibold text-foreground">
          {messages.receipt.title}
        </h3>
        <p className="text-sm text-muted-foreground">
          {[data.customerName, data.serviceName, data.professionalName]
            .filter(Boolean)
            .join(" · ")}
        </p>
      </header>

      <dl className="space-y-1 text-sm">
        <div className="flex justify-between gap-2">
          <dt className="text-muted-foreground">{messages.dialog.total}</dt>
          <dd className="font-mono tabular-nums">{formatCentsToBRL(data.totalCents)}</dd>
        </div>
        {data.paidCents > 0 ? (
          <div className="flex justify-between gap-2">
            <dt className="text-muted-foreground">{messages.receipt.paid}</dt>
            <dd data-testid="receipt-paid" className="font-mono tabular-nums">
              {formatCentsToBRL(data.paidCents)}
            </dd>
          </div>
        ) : null}
        {data.tipCents > 0 ? (
          <div className="flex justify-between gap-2">
            <dt className="text-muted-foreground">{messages.receipt.tip}</dt>
            <dd data-testid="receipt-tip" className="font-mono tabular-nums">
              {formatCentsToBRL(data.tipCents)}
            </dd>
          </div>
        ) : null}
        {data.changeCents != null ? (
          <div className="flex justify-between gap-2">
            <dt className="text-muted-foreground">{messages.receipt.change}</dt>
            <dd data-testid="receipt-change" className="font-mono tabular-nums">
              {formatCentsToBRL(data.changeCents)}
            </dd>
          </div>
        ) : null}
        <div className="flex justify-between gap-2">
          <dt className="text-muted-foreground">{messages.settlement.status}</dt>
          <dd data-testid="receipt-status" className="text-foreground">
            {messages.status[data.status]}
          </dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-muted-foreground">{messages.receipt.date}</dt>
          <dd className="tabular-nums text-foreground">{dateLabel}</dd>
        </div>
      </dl>

      <div className="space-y-1">
        <p className="text-sm font-medium text-foreground">
          {messages.receipt.methods}
        </p>
        <ul className="space-y-1 text-sm">
          {data.lines.map((line, index) => (
            <li
              key={`${line.method}-${index}`}
              className="flex justify-between gap-2"
            >
              <span className="text-muted-foreground">
                {messages.method[line.method]}
              </span>
              <span className="font-mono tabular-nums">
                {formatCentsToBRL(line.amountCents)}
              </span>
            </li>
          ))}
        </ul>
      </div>

      <p className="text-xs text-muted-foreground">{messages.receipt.note}</p>
    </article>
  );
}
