import { Button } from "@/components/ui/button";
import { formatCentsToBRL } from "@/lib/money";
import { formatDateInTenantTz } from "@/lib/datetime";
import { formatMessage, type PaymentsMessages } from "./payments-messages";
import type { PendingCharge } from "@/types/payments";

export interface PendingChargeCardProps {
  charge: PendingCharge;
  canViewQr: boolean;
  canCancel: boolean;
  canReissue: boolean;
  expired: boolean;
  onShowQr: (charge: PendingCharge) => void;
  onCancel: (charge: PendingCharge) => void;
  onReissue: (charge: PendingCharge) => void;
  messages: PaymentsMessages;
  timeZone: string;
  /** Baixa manual (admin) — ação adicional opcional. */
  canConfirmManual?: boolean;
  onConfirmManual?: (charge: PendingCharge) => void;
}

/**
 * Cobrança PIX pendente no settlement (ADR-004 §5.3.7). Um `<li>`; ações
 * condicionadas aos flags do servidor. Sem QR gerado → "PIX não gerado" e
 * retry, nunca `<img src="">`.
 */
export function PendingChargeCard({
  charge,
  canViewQr,
  canCancel,
  canReissue,
  expired,
  onShowQr,
  onCancel,
  onReissue,
  messages,
  timeZone,
  canConfirmManual = false,
  onConfirmManual,
}: PendingChargeCardProps) {
  const hasQr = charge.pix_qr_code !== null;

  return (
    <li
      data-testid={`settlement-pending-charge-${charge.id}`}
      className="space-y-2 rounded-md border border-border bg-card p-3"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-sm tabular-nums text-foreground">
          {formatCentsToBRL(charge.amount_cents)}
        </span>
        {expired ? (
          <span className="rounded-full bg-status-cancelado px-2 py-0.5 text-xs font-medium text-status-cancelado-foreground">
            {messages.settlement.expired}
          </span>
        ) : null}
      </div>

      {charge.expires_at ? (
        <p className="text-xs text-muted-foreground">
          {formatMessage(messages.pix.expiresAt, {
            data: formatDateInTenantTz(charge.expires_at, timeZone),
          })}
        </p>
      ) : null}

      {!hasQr ? (
        <p className="text-sm text-muted-foreground">{messages.settlement.noQr}</p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {canViewQr && hasQr && !expired ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onShowQr(charge)}
            className="h-11 min-h-[44px]"
          >
            {messages.settlement.showQr}
          </Button>
        ) : null}

        {canReissue && expired ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onReissue(charge)}
            className="h-11 min-h-[44px]"
          >
            {messages.settlement.reissue}
          </Button>
        ) : null}

        {canReissue && !hasQr && !expired ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onReissue(charge)}
            className="h-11 min-h-[44px]"
          >
            {messages.actions.retry}
          </Button>
        ) : null}

        {canConfirmManual && onConfirmManual ? (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => onConfirmManual(charge)}
            className="h-11 min-h-[44px]"
          >
            {messages.settlement.confirmManual}
          </Button>
        ) : null}

        {canCancel ? (
          <Button
            type="button"
            variant="destructive"
            size="sm"
            onClick={() => onCancel(charge)}
            className="h-11 min-h-[44px]"
          >
            {messages.settlement.cancelCharge}
          </Button>
        ) : null}
      </div>
    </li>
  );
}
