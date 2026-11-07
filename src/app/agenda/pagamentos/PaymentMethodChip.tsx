import { useId } from "react";

import { Button } from "@/components/ui/button";
import { formatMessage, type PaymentsMessages } from "./payments-messages";
import type { PaymentMethod } from "@/types/payments";

export interface PaymentMethodChipProps {
  method: PaymentMethod;
  disabled?: boolean;
  disabledReason?: string;
  onSelect: (method: PaymentMethod) => void;
  messages: PaymentsMessages;
}

/**
 * Chip de **ação** (`Adicionar <método>`), não de seleção (ADR-004 D2):
 * sem `aria-pressed`, sem `role="radio"`. Alvo de toque ≥ 44 px.
 */
export function PaymentMethodChip({
  method,
  disabled = false,
  disabledReason,
  onSelect,
  messages,
}: PaymentMethodChipProps) {
  const reasonId = useId();
  const describedBy = disabled && disabledReason ? reasonId : undefined;

  return (
    <div className="flex flex-col gap-1">
      <Button
        type="button"
        variant="outline"
        data-testid={`payment-method-chip-${method}`}
        aria-label={formatMessage(messages.actions.addMethodNamed, {
          metodo: messages.method[method],
        })}
        aria-describedby={describedBy}
        disabled={disabled}
        onClick={() => onSelect(method)}
        className="h-11 min-h-[44px]"
      >
        {messages.method[method]}
      </Button>
      {describedBy ? (
        <span id={reasonId} className="sr-only">
          {disabledReason}
        </span>
      ) : null}
    </div>
  );
}
