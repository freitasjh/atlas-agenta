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
import { useIgnoreLines } from "@/hooks/useConciliacao";
import {
  formatarDataExtrato,
  ignorarLinhasSchema,
  valorAssinado,
  type BankLine,
} from "@/lib/conciliacao";

interface IgnorarLinhasDialogProps {
  linhas: BankLine[] | null;
  aoFechar: () => void;
}

/**
 * Ignorar linha(s) do extrato (ADR-08, RF-24). O motivo é OBRIGATÓRIO — o banco
 * também barra (`bank_lines_ignorado_motivo_check`) e a RPC exige ≥3 chars. O
 * motivo fica auditado (`reconciliation_ignored`) e visível na linha.
 */
export function IgnorarLinhasDialog({ linhas, aoFechar }: IgnorarLinhasDialogProps) {
  const ignorar = useIgnoreLines();
  const [motivo, setMotivo] = useState("");
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (linhas === null) {
      setMotivo("");
      setErro(null);
      ignorar.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linhas]);

  async function onConfirmar() {
    if (!linhas || linhas.length === 0) return;
    const parsed = ignorarLinhasSchema.safeParse({ motivo });
    if (!parsed.success) {
      setErro(parsed.error.issues[0]?.message ?? "Informe o motivo.");
      return;
    }
    setErro(null);
    try {
      const resultado = await ignorar.mutateAsync({
        bank_line_ids: linhas.map((linha) => linha.id),
        motivo: parsed.data.motivo,
      });
      toast.success(
        resultado.ignored === 1
          ? "1 linha ignorada."
          : `${resultado.ignored} linhas ignoradas.`,
      );
      aoFechar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível ignorar as linhas.");
    }
  }

  const total = linhas?.reduce((soma, linha) => soma + linha.valor_cents, 0) ?? 0;

  return (
    <Dialog open={linhas !== null} onOpenChange={(v) => (v ? undefined : aoFechar())}>
      <DialogContent className="sm:max-w-md" aria-label="Ignorar linhas do extrato">
        <DialogHeader>
          <DialogTitle>Ignorar linha do extrato</DialogTitle>
          <DialogDescription>
            {linhas && linhas.length > 0
              ? `${linhas.length} linha(s) · ${valorAssinado(total)}. Linhas ignoradas saem da conciliação e ficam registradas com o motivo.`
              : null}
          </DialogDescription>
        </DialogHeader>

        {linhas ? (
          <ul className="max-h-32 space-y-1 overflow-y-auto text-sm">
            {linhas.map((linha) => (
              <li key={linha.id} className="flex justify-between gap-2">
                <span className="min-w-0 truncate">
                  {formatarDataExtrato(linha.data)} · {linha.descricao}
                </span>
                <span className="whitespace-nowrap tabular-nums">
                  {valorAssinado(linha.valor_cents)}
                </span>
              </li>
            ))}
          </ul>
        ) : null}

        <div className="space-y-2">
          <Label htmlFor="conciliacao-motivo-ignorar">Motivo</Label>
          <textarea
            id="conciliacao-motivo-ignorar"
            className="flex min-h-20 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            placeholder="Ex.: tarifa já lançada manualmente"
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
            className="min-h-11"
            disabled={ignorar.isPending}
            onClick={() => void onConfirmar()}
          >
            {ignorar.isPending ? "Ignorando…" : "Ignorar com motivo"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
