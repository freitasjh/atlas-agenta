import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useCountdown } from "@/app/lista-espera/useCountdown";
import { formatCountdown } from "@/app/lista-espera/model";
import {
  formatWaitlistMessage,
  type WaitlistMessages,
} from "@/app/lista-espera/waitlist-messages";

interface WaitlistOfferDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  messages: WaitlistMessages;
  customerName: string;
  slotLabel: string;
  expiresAt: string | null;
  confirming: boolean;
  declining: boolean;
  onConfirm: () => void;
  onDecline: () => void;
  onExpire: () => void;
}

/**
 * Oferta automática com countdown (RF-09, UX-SPEC B). Countdown em `MM:SS`
 * com `aria-live`; ao expirar mostra estado expirado e chama `onExpire` (a
 * vaga passa ao próximo). Confirmar/Recusar desabilitam durante a request.
 */
export function WaitlistOfferDialog({
  open,
  onOpenChange,
  messages,
  customerName,
  slotLabel,
  expiresAt,
  confirming,
  declining,
  onConfirm,
  onDecline,
  onExpire,
}: WaitlistOfferDialogProps) {
  const t = messages.offer;
  const { remaining, expired } = useCountdown(expiresAt, { onExpire });
  const busy = confirming || declining;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {expired ? t.expiredTitle : t.title}
          </DialogTitle>
          <DialogDescription>
            {expired
              ? t.expiredDescription
              : formatWaitlistMessage(t.description, { cliente: customerName })}
          </DialogDescription>
        </DialogHeader>

        {!expired ? (
          <div className="space-y-3 py-2">
            <div className="rounded-lg bg-muted/40 p-4">
              <p className="text-xs font-medium uppercase text-muted-foreground">
                {t.slotLabel}
              </p>
              <p className="mt-1 text-base font-semibold text-foreground">{slotLabel}</p>
            </div>
            <div className="text-center">
              <p className="text-xs font-medium uppercase text-muted-foreground">
                {t.countdownLabel}
              </p>
              <p
                className="font-display text-3xl font-semibold tabular-nums tracking-tight text-foreground"
                role="timer"
                aria-live="assertive"
                aria-label={formatWaitlistMessage(t.countdownAria, {
                  restante: formatCountdown(remaining),
                })}
              >
                {formatCountdown(remaining)}
              </p>
            </div>
          </div>
        ) : null}

        <DialogFooter className="gap-2 sm:gap-0">
          {expired ? (
            <Button type="button" onClick={() => onOpenChange(false)}>
              {t.close}
            </Button>
          ) : (
            <>
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={onDecline}
              >
                {declining && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
                {declining ? t.declining : t.decline}
              </Button>
              <Button type="button" disabled={busy} onClick={onConfirm}>
                {confirming && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
                {confirming ? t.confirming : t.confirm}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
