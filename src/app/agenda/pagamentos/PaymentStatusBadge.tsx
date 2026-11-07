import { AlertCircle } from "lucide-react";

import { formatMessage, type PaymentsMessages } from "./payments-messages";
import { cn } from "@/lib/utils";
import type { PaymentStatus } from "@/types/payments";

export interface PaymentStatusBadgeProps {
  status: PaymentStatus;
  messages: PaymentsMessages;
  className?: string;
}

/**
 * Selo textual de pagamento pendente (ADR-004 §5.3.1). `quitado` não renderiza
 * nada. Texto + ícone + `aria-label`; nunca só cor.
 */
export function PaymentStatusBadge({
  status,
  messages,
  className,
}: PaymentStatusBadgeProps) {
  if (status === "quitado") return null;
  const statusLabel = messages.status[status];
  const ariaLabel = formatMessage(messages.badge.pendingAria, {
    status: statusLabel,
  });

  return (
    <span
      data-testid="payment-badge"
      aria-label={ariaLabel}
      className={cn(
        "inline-flex items-center gap-1 rounded-full bg-status-pendente px-2 py-0.5 text-xs font-medium text-status-pendente-foreground",
        className,
      )}
    >
      <AlertCircle aria-hidden="true" className="h-3.5 w-3.5" />
      <span>{messages.badge.pending}</span>
      {status === "aguardando_pix" ? (
        <span>{` · ${messages.badge.awaitingPix}`}</span>
      ) : null}
    </span>
  );
}
