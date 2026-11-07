import type { PaymentsMessages } from "./payments-messages";
import { formatCentsToBRL } from "@/lib/money";

export interface PaymentTotalsSummaryProps {
  totalCents: number;
  paidCents: number;
  reservedCents?: number;
  draftCents: number;
  remainingCents: number;
  tipCents: number;
  messages: PaymentsMessages;
}

function Row({
  label,
  value,
  testId,
  live,
}: {
  label: string;
  value: string;
  testId?: string;
  live?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-2 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd
        data-testid={testId}
        aria-live={live ? "polite" : undefined}
        aria-atomic={live ? "true" : undefined}
        className="font-mono tabular-nums text-foreground"
      >
        {value}
      </dd>
    </div>
  );
}

/**
 * Resumo de totais do diálogo (ADR-004 §5.3.5). Região viva só no saldo/troco,
 * para não interromper a digitação; valores sempre por `formatCentsToBRL`.
 */
export function PaymentTotalsSummary({
  totalCents,
  paidCents,
  draftCents,
  remainingCents,
  tipCents,
  messages,
}: PaymentTotalsSummaryProps) {
  return (
    <dl
      role="group"
      aria-label={messages.dialog.title}
      data-testid="payment-totals"
      className="space-y-1 rounded-md border border-border bg-muted/20 p-3"
    >
      <Row
        label={messages.dialog.total}
        value={formatCentsToBRL(totalCents)}
        testId="payment-total"
      />
      <Row label={messages.dialog.paid} value={formatCentsToBRL(paidCents)} />
      <Row
        label={messages.dialog.remaining}
        value={formatCentsToBRL(remainingCents)}
        testId="payment-remaining"
        live
      />
      {draftCents > 0 ? (
        <Row
          label={messages.fields.amount}
          value={formatCentsToBRL(draftCents)}
          testId="payment-draft"
        />
      ) : null}
      {tipCents > 0 ? (
        <Row
          label={messages.fields.tip}
          value={formatCentsToBRL(tipCents)}
          testId="payment-tip"
        />
      ) : null}
    </dl>
  );
}
