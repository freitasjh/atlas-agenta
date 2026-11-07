import { Wallet } from "lucide-react";

import { Button } from "@/components/ui/button";
import { PaymentLineRow } from "./PaymentLineRow";
import { PaymentMethodChip } from "./PaymentMethodChip";
import type { PaymentsMessages } from "./payments-messages";
import type { PaymentLineDraft } from "./payment-types";
import { PAYMENT_METHODS, type PaymentMethod } from "@/types/payments";

export interface PaymentLinesEditorProps {
  lines: PaymentLineDraft[];
  disabled: boolean;
  onAdd: (method: PaymentMethod) => void;
  onUpdate: (line: PaymentLineDraft) => void;
  onRemove: (key: string) => void;
  messages: PaymentsMessages;
  /** Motivo por método indisponível (ex.: PIX do sistema sem Asaas). */
  methodDisabledReasons?: Partial<Record<PaymentMethod, string>>;
  showValidation?: boolean;
}

/**
 * Fileira de chips + lista de linhas (ADR-004 §5.3.4). Compõe apenas — o
 * saldo/estado vive na shell. "Registrar depois" NÃO fica aqui (rodapé).
 */
export function PaymentLinesEditor({
  lines,
  disabled,
  onAdd,
  onUpdate,
  onRemove,
  messages,
  methodDisabledReasons,
  showValidation = false,
}: PaymentLinesEditorProps) {
  const usedMethods = new Set(lines.map((line) => line.method));
  const nextMethod = PAYMENT_METHODS.find(
    (method) => !usedMethods.has(method) && !methodDisabledReasons?.[method],
  );

  function disabledReasonFor(method: PaymentMethod): string | undefined {
    const external = methodDisabledReasons?.[method];
    if (external) return external;
    if (method === "pix_sistema" && usedMethods.has("pix_sistema")) {
      return messages.error.pixUsed;
    }
    return undefined;
  }

  return (
    <div data-testid="payment-lines-editor" className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {PAYMENT_METHODS.map((method) => {
          const reason = disabledReasonFor(method);
          return (
            <PaymentMethodChip
              key={method}
              method={method}
              disabled={disabled || !!reason}
              disabledReason={reason}
              onSelect={onAdd}
              messages={messages}
            />
          );
        })}
        <Button
          type="button"
          variant="secondary"
          onClick={() => nextMethod && onAdd(nextMethod)}
          disabled={disabled || !nextMethod}
          className="h-11 min-h-[44px]"
        >
          {messages.actions.addMethod}
        </Button>
      </div>

      {lines.length === 0 ? (
        <div className="flex items-center gap-2 rounded-md border border-dashed border-border p-4 text-sm text-muted-foreground">
          <Wallet aria-hidden="true" className="h-4 w-4" />
          <span>{messages.dialog.emptyLines}</span>
        </div>
      ) : (
        <ul className="space-y-2">
          {lines.map((line) => (
            <PaymentLineRow
              key={line.key}
              line={line}
              remainingCents={0}
              disabled={disabled}
              onChange={onUpdate}
              onRemove={onRemove}
              messages={messages}
              showValidation={showValidation}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
