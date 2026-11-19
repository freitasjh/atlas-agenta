import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { useUndoLink } from "@/hooks/useConciliacao";
import {
  formatarDataExtrato,
  undoDentroDaJanela,
  undoMotivoSchema,
  valorAssinado,
  type BankLine,
  type ReconciliationLink,
} from "@/lib/conciliacao";

export interface DesfazerAlvo {
  linha: BankLine;
  vinculo: ReconciliationLink;
}

interface DesfazerVinculoDialogProps {
  alvo: DesfazerAlvo | null;
  aoFechar: () => void;
}

/**
 * Desfazer vínculo de conciliação FORA da janela de 5s (ADR-08, RF-25): exige
 * motivo e o banco registra `reconciliation_undo_audited`. Dentro da janela o
 * caminho é o toast "Desfazer" (sem motivo). Vínculo que criou lançamento
 * (`origem = "entry"`) não é desfazível — o banco recusa e a linha não mostra o
 * botão.
 */
export function DesfazerVinculoDialog({ alvo, aoFechar }: DesfazerVinculoDialogProps) {
  const desfazer = useUndoLink();
  const [motivo, setMotivo] = useState("");
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (alvo === null) {
      setMotivo("");
      setErro(null);
      desfazer.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alvo]);

  async function onConfirmar() {
    if (!alvo) return;
    const parsed = undoMotivoSchema.safeParse({ motivo });
    if (!parsed.success) {
      setErro(parsed.error.issues[0]?.message ?? "Informe o motivo.");
      return;
    }
    setErro(null);
    try {
      await desfazer.mutateAsync({ link_id: alvo.vinculo.id, motivo: parsed.data.motivo });
      toast.success("Conciliação desfeita.", {
        description: "A linha voltou para pendente e o motivo foi registrado na auditoria.",
      });
      aoFechar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível desfazer a conciliação.");
    }
  }

  const dentroDaJanela = alvo
    ? undoDentroDaJanela(alvo.vinculo.created_at)
    : false;

  return (
    <Dialog open={alvo !== null} onOpenChange={(v) => (v ? undefined : aoFechar())}>
      <DialogContent className="sm:max-w-md" aria-label="Desfazer conciliação">
        <DialogHeader>
          <DialogTitle>Desfazer conciliação</DialogTitle>
          <DialogDescription>
            {alvo
              ? `${formatarDataExtrato(alvo.linha.data)} · ${alvo.linha.descricao} · ${valorAssinado(
                  alvo.linha.valor_cents,
                )}. ${
                  dentroDaJanela
                    ? "Você ainda está na janela de 5 segundos, mas o desfazer por aqui fica auditado."
                    : "Passaram-se mais de 5 segundos: o desfazer exige motivo e fica auditado."
                }`
              : null}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <Label htmlFor="conciliacao-motivo-undo">Motivo</Label>
          <textarea
            id="conciliacao-motivo-undo"
            className="flex min-h-20 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            placeholder="Ex.: conciliei com o lançamento errado"
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
          <Button type="button" variant="outline" className="min-h-11" onClick={aoFechar}>
            Voltar
          </Button>
          <Button
            type="button"
            variant="destructive"
            className="min-h-11"
            disabled={desfazer.isPending}
            onClick={() => void onConfirmar()}
          >
            {desfazer.isPending ? "Desfazendo…" : "Desfazer conciliação"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
