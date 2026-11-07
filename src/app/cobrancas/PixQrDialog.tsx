import { toast } from "sonner";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { PixQrPanel } from "@/app/agenda/pagamentos/PixQrPanel";
import { paymentsMessages } from "@/app/agenda/pagamentos/payments-messages";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import type { Charge } from "@/hooks/useCharges";

export interface PixQrDialogProps {
  charge: Charge | null;
  open: boolean;
  onClose: () => void;
}

/**
 * Shell fina do QR em `/cobrancas` (ADR-004 §5.2): **um** `Dialog` com o
 * `PixQrPanel` compartilhado. Nenhum markup de QR duplicado.
 */
export function PixQrDialog({ charge, open, onClose }: PixQrDialogProps) {
  const { tenant } = useCurrentUser();
  const timeZone = tenant?.timezone ?? "America/Sao_Paulo";

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-md" data-testid="pix-qr-dialog">
        <DialogHeader>
          <DialogTitle>{paymentsMessages.pix.title}</DialogTitle>
          <DialogDescription>
            {paymentsMessages.pix.dialogDescription}
          </DialogDescription>
        </DialogHeader>
        {charge ? (
          <PixQrPanel
            qrCode={charge.pix_qr_code}
            copyPaste={charge.pix_copy_paste}
            expiresAt={charge.expires_at}
            amountCents={charge.amount_cents}
            status={charge.status}
            messages={paymentsMessages}
            timeZone={timeZone}
            onCopyResult={(result) => {
              if (result === "ok") toast.success(paymentsMessages.actions.copied);
              else toast.error(paymentsMessages.actions.copyFailed);
            }}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
