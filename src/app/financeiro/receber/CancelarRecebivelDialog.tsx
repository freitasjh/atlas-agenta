import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useCancelReceivable, useCancelReceivableCharge } from "@/hooks/useReceivables";
import { receivableHasActiveCharge, type Receivable } from "@/lib/receber";

interface CancelarRecebivelDialogProps {
  conta: Receivable | null;
  aoFechar: () => void;
}

/**
 * Cancelamento de avulsa sem recebimento (ADR-07). Só existe para conta
 * `pendente` sem settlement — a RPC recusa o resto (PT409).
 *
 * Conta com PIX vivo: o PIX é cancelado no gateway ANTES da baixa na conta
 * (senão o cliente continua com um QR pagável de uma conta cancelada e a RPC
 * responde `RECEIVABLE_HAS_ACTIVE_CHARGE`). Se o gateway recusar, a conta não é
 * cancelada e o motivo aparece em pt-BR.
 */
export function CancelarRecebivelDialog({ conta, aoFechar }: CancelarRecebivelDialogProps) {
  const aberto = conta !== null;
  const cancelar = useCancelReceivable();
  const cancelarPix = useCancelReceivableCharge();
  const [motivo, setMotivo] = useState("");
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (!aberto) {
      setMotivo("");
      setErro(null);
      cancelar.reset();
      cancelarPix.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aberto]);

  async function confirmar() {
    if (!conta) return;
    setErro(null);
    try {
      if (receivableHasActiveCharge(conta)) {
        await cancelarPix.mutateAsync({ receivable_id: conta.id });
      }
      await cancelar.mutateAsync({
        receivable_id: conta.id,
        motivo: motivo.trim() === "" ? null : motivo.trim(),
      });
      aoFechar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível cancelar a conta.");
    }
  }

  const ocupado = cancelar.isPending || cancelarPix.isPending;

  return (
    <Dialog open={aberto} onOpenChange={(v) => (v ? undefined : aoFechar())}>
      <DialogContent className="sm:max-w-md" aria-label="Cancelar conta a receber">
        <DialogHeader>
          <DialogTitle>Cancelar cobrança</DialogTitle>
          <DialogDescription>
            {conta
              ? `"${conta.descricao}" deixa de ser cobrada. Contas com recebimento registrado não podem ser canceladas.${
                  receivableHasActiveCharge(conta)
                    ? " O PIX em aberto será cancelado no gateway antes da baixa."
                    : ""
                }`
              : ""}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <Label htmlFor="cancelar-recebivel-motivo">Motivo (opcional)</Label>
          <Input
            id="cancelar-recebivel-motivo"
            autoComplete="off"
            value={motivo}
            maxLength={200}
            onChange={(e) => setMotivo(e.target.value)}
          />
        </div>

        {erro ? (
          <p role="alert" className="text-sm text-destructive">
            {erro}
          </p>
        ) : null}

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={aoFechar}>
            Voltar
          </Button>
          <Button
            type="button"
            variant="destructive"
            className="min-h-11"
            disabled={ocupado}
            onClick={() => void confirmar()}
          >
            {ocupado ? "Cancelando…" : "Cancelar cobrança"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
