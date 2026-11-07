import { useId } from "react";
import { Copy } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatCentsToBRL } from "@/lib/money";
import { formatDateInTenantTz } from "@/lib/datetime";
import { formatMessage, type PaymentsMessages } from "./payments-messages";

export interface PixQrPanelProps {
  qrCode: string | null;
  copyPaste: string | null;
  expiresAt: string | null;
  amountCents: number;
  status?: string;
  messages: PaymentsMessages;
  timeZone: string;
  onCopyResult?: (result: "ok" | "error") => void;
}

function normalizeQrCode(value: string | null): string | null {
  if (!value) return null;
  return value.startsWith("data:") ? value : `data:image/png;base64,${value}`;
}

/**
 * Apresentação do PIX (ADR-004 §5.3.10): QR + copia-e-cola + expiração/valor.
 * Puro — sem timer, sem `Dialog`, sem decisão de "pago". O toast de cópia é da
 * shell, via `onCopyResult`.
 */
export function PixQrPanel({
  qrCode,
  copyPaste,
  expiresAt,
  amountCents,
  messages,
  timeZone,
  onCopyResult,
}: PixQrPanelProps) {
  const src = normalizeQrCode(qrCode);
  const copyId = useId();

  async function copy() {
    try {
      await navigator.clipboard.writeText(copyPaste ?? "");
      onCopyResult?.("ok");
    } catch {
      onCopyResult?.("error");
    }
  }

  return (
    <div data-testid="pix-qr-panel" className="space-y-3">
      {src ? (
        <div className="flex justify-center">
          <img
            src={src}
            alt={messages.pix.qrAlt}
            className="h-48 w-48 rounded-md bg-white p-2"
          />
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">{messages.pix.unavailable}</p>
      )}

      <div className="space-y-1">
        <label
          htmlFor={copyId}
          className="text-sm font-medium text-foreground"
        >
          {messages.pix.copyLabel}
        </label>
        <div className="flex gap-2">
          <Input
            id={copyId}
            readOnly
            value={copyPaste ?? ""}
            aria-label={messages.pix.copyLabel}
          />
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={() => void copy()}
            aria-label={messages.actions.copy}
            className="h-11 w-11 min-h-[44px] min-w-[44px]"
          >
            <Copy className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        {expiresAt ? (
          <span>
            {formatMessage(messages.pix.expiresAt, {
              data: formatDateInTenantTz(expiresAt, timeZone),
            })}
          </span>
        ) : (
          <span aria-hidden="true" />
        )}
        <span className="font-mono tabular-nums">
          {formatCentsToBRL(amountCents)}
        </span>
      </div>
    </div>
  );
}
