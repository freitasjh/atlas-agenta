import { useId } from "react";
import { Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { MoneyInput } from "@/components/MoneyInput";
import { computeChangeCents } from "./payment-math";
import type { PaymentsMessages } from "./payments-messages";
import type { PaymentLineDraft } from "./payment-types";
import { CARD_PAYMENT_METHODS } from "@/types/payments";
import { formatCentsToBRL } from "@/lib/money";

export interface PaymentLineRowProps {
  line: PaymentLineDraft;
  /** Saldo restante do atendimento (informativo para o operador). */
  remainingCents: number;
  disabled: boolean;
  onChange: (line: PaymentLineDraft) => void;
  onRemove: (key: string) => void;
  messages: PaymentsMessages;
  /** Exibe os erros de validação (ativado após tentar enviar). */
  showValidation?: boolean;
}

/**
 * Linha de recebimento (ADR-004 §5.3.3): um único `<li>` que vira card via
 * CSS. Dinheiro tem "Valor recebido"/"Troco"; cartões e PIX da maquininha
 * exigem confirmação. Nenhum dado de cartão, bandeira, NSU ou CVV.
 */
export function PaymentLineRow({
  line,
  disabled,
  onChange,
  onRemove,
  messages,
  showValidation = false,
}: PaymentLineRowProps) {
  const amountId = useId();
  const tipId = useId();
  const tipHintId = useId();
  const cashId = useId();
  const changeId = useId();
  const cardId = useId();
  const cashErrorId = useId();
  const cardErrorId = useId();

  const isCash = line.method === "dinheiro";
  const isCard = CARD_PAYMENT_METHODS.includes(line.method);
  const changeCents = computeChangeCents(
    line.cashReceivedCents,
    line.amountCents,
  );
  const cashShort =
    showValidation &&
    isCash &&
    line.cashReceivedCents > 0 &&
    line.cashReceivedCents < line.amountCents;
  const cardMissing = showValidation && isCard && !line.cardConfirmed;

  return (
    <li
      data-testid={`payment-line-${line.key}`}
      className="grid gap-3 rounded-md border border-border bg-card p-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto]"
    >
      <div className="flex items-center justify-between gap-2 md:col-span-4">
        <span className="text-sm font-medium text-foreground">
          {messages.method[line.method]}
        </span>
        {!disabled ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={messages.actions.removeLine}
            onClick={() => onRemove(line.key)}
            className="h-11 w-11 min-h-[44px] min-w-[44px]"
          >
            <Trash2 className="h-4 w-4" aria-hidden="true" />
          </Button>
        ) : null}
      </div>

      <div className="space-y-1">
        <Label htmlFor={amountId}>{messages.fields.amount}</Label>
        <MoneyInput
          id={amountId}
          value={line.amountCents}
          disabled={disabled}
          data-invalid={cashShort ? "true" : undefined}
          onChange={(amountCents) => onChange({ ...line, amountCents })}
        />
      </div>

      <div className="space-y-1">
        <Label htmlFor={tipId}>{messages.fields.tip}</Label>
        <MoneyInput
          id={tipId}
          value={line.tipCents}
          disabled={disabled}
          aria-describedby={tipHintId}
          onChange={(tipCents) => onChange({ ...line, tipCents })}
        />
        <p id={tipHintId} className="text-xs text-muted-foreground">
          {messages.fields.tipHint}
        </p>
      </div>

      {isCash ? (
        <>
          <div className="space-y-1">
            <Label htmlFor={cashId}>{messages.fields.cashReceived}</Label>
            <MoneyInput
              id={cashId}
              value={line.cashReceivedCents}
              disabled={disabled}
              aria-invalid={cashShort ? true : undefined}
              aria-describedby={cashShort ? cashErrorId : undefined}
              data-invalid={cashShort ? "true" : undefined}
              onChange={(cashReceivedCents) =>
                onChange({ ...line, cashReceivedCents })
              }
            />
          </div>
          <div className="space-y-1">
            <span className="text-sm font-medium text-foreground">
              {messages.fields.change}
            </span>
            <output
              htmlFor={`${amountId} ${cashId}`}
              data-testid={`payment-line-${line.key}-change`}
              aria-live="polite"
              className="block font-mono text-sm tabular-nums text-foreground"
            >
              {formatCentsToBRL(changeCents)}
            </output>
          </div>
        </>
      ) : null}

      {isCard ? (
        <div className="space-y-1 md:col-span-2">
          <div className="flex items-center gap-2">
            <Checkbox
              id={cardId}
              checked={line.cardConfirmed}
              disabled={disabled}
              aria-invalid={cardMissing ? true : undefined}
              aria-describedby={cardMissing ? cardErrorId : undefined}
              data-invalid={cardMissing ? "true" : undefined}
              onCheckedChange={(checked) =>
                onChange({ ...line, cardConfirmed: checked === true })
              }
            />
            <Label htmlFor={cardId}>{messages.fields.cardConfirmed}</Label>
          </div>
        </div>
      ) : null}

      {isCash ? (
        <p id={changeId} className="sr-only">
          {messages.fields.change}
        </p>
      ) : null}

      {cashShort ? (
        <p
          id={cashErrorId}
          role="alert"
          data-testid={`payment-line-${line.key}-error`}
          className="text-sm text-destructive md:col-span-4"
        >
          {messages.error.cashShort}
        </p>
      ) : null}

      {cardMissing ? (
        <p
          id={cardErrorId}
          role="alert"
          data-testid={`payment-line-${line.key}-error`}
          className="text-sm text-destructive md:col-span-4"
        >
          {messages.error.cardNotConfirmed}
        </p>
      ) : null}
    </li>
  );
}
