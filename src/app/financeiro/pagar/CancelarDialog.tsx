import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { useCancelPayable } from "@/hooks/usePayables";
import type { Payable } from "@/lib/pagar";
import { formatCentsToBRL } from "@/lib/money";

interface CancelarDialogProps {
  conta: Payable | null;
  aoFechar: () => void;
}

/**
 * Cancelamento de conta a pagar (ADR-06 `payable_cancel`): só conta `pendente`
 * sem baixas. Exige confirmação explícita + motivo auditável (vai ao audit_log).
 * Parcial/paga com baixa o banco nega com PT409 — o botão nem aparece nesses casos.
 */
export function CancelarDialog({ conta, aoFechar }: CancelarDialogProps) {
  const cancelar = useCancelPayable();
  const [motivo, setMotivo] = useState("");
  const [erro, setErro] = useState<string | null>(null);

  function aoAbrir(v: boolean) {
    if (!v) {
      setMotivo("");
      setErro(null);
      cancelar.reset();
      aoFechar();
    }
  }

  async function onConfirmar() {
    if (!conta) return;
    if (motivo.trim().length < 3) {
      setErro("Informe o motivo do cancelamento (mínimo 3 letras).");
      return;
    }
    setErro(null);
    try {
      await cancelar.mutateAsync({ payable_id: conta.id, motivo: motivo.trim() });
      setMotivo("");
      cancelar.reset();
      aoFechar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível cancelar a conta.");
    }
  }

  return (
    <Dialog open={conta !== null} onOpenChange={aoAbrir}>
      <DialogContent className="sm:max-w-md" aria-label="Cancelar conta a pagar">
        <DialogHeader>
          <DialogTitle>Cancelar conta</DialogTitle>
          <DialogDescription>
            {conta ? (
              <>
                {conta.descricao} · {formatCentsToBRL(conta.valor_cents)}. O cancelamento é definitivo e
                só vale para conta pendente sem baixas.
              </>
            ) : null}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="cancelar-motivo">Motivo do cancelamento</Label>
          <textarea
            id="cancelar-motivo"
            className="flex min-h-20 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            placeholder="Ex.: lançamento em duplicidade"
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
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" className="min-h-11" onClick={() => aoAbrir(false)}>
            Voltar
          </Button>
          <Button
            type="button"
            variant="destructive"
            className="min-h-11"
            disabled={cancelar.isPending}
            onClick={() => void onConfirmar()}
          >
            {cancelar.isPending ? "Cancelando…" : "Confirmar cancelamento"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
