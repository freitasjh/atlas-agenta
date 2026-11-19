import { Loader2 } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

interface BulkStatusConfirmProps {
  /** `false` desmonta o conteúdo (padrão Dialog controlado). */
  open: boolean;
  /** Quantidade de itens no lote. */
  count: number;
  confirming: boolean;
  onClose: () => void;
  /** Confirma o lote — sem motivo: o lote não persiste motivo (ADR-04). */
  onConfirm: () => void;
}

/**
 * Confirmação única do lote de cancelamento (ADR-04): cancelar exige
 * confirmação explícita com a contagem. A ação é final e irreversível na
 * máquina de estados (`cancelado` é final, sem desfazer) — a copy declara
 * isso porque não há botão Desfazer após o lote.
 */
export function BulkStatusConfirm({
  open,
  count,
  confirming,
  onClose,
  onConfirm,
}: BulkStatusConfirmProps) {
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Cancelar {count} agendamentos?</DialogTitle>
          <DialogDescription>
            {count} agendamentos serão cancelados e liberarão os horários dos
            profissionais. Esta é uma etapa final e não poderá ser desfeita
            pelo sistema.
          </DialogDescription>
        </DialogHeader>

        <DialogFooter className="mt-4 gap-2 sm:gap-0">
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            disabled={confirming}
          >
            Voltar
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={() => onConfirm()}
            disabled={confirming}
          >
            {confirming ? (
              <>
                <Loader2 className="animate-spin" aria-hidden="true" />
                Cancelando…
              </>
            ) : (
              `Cancelar ${count} agendamentos`
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
