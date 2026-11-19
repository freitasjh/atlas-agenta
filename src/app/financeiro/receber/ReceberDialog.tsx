import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

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
import { useSettleReceivable } from "@/hooks/useReceivables";
import { formatCentsToBRL, parseBRLToCents } from "@/lib/money";
import {
  RECEBIMENTO_METODO_META,
  RECEBIMENTO_METODOS,
  recebimentoSchema,
  receivableHasActiveCharge,
  restoReceivable,
  type RecebimentoInput,
  type Receivable,
} from "@/lib/receber";

interface ReceberDialogProps {
  conta: Receivable | null;
  aoFechar: () => void;
}

function agoraLocalInput(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Converte `datetime-local` (fuso local) para ISO UTC. */
function localParaIso(valor: string): string | null {
  const d = new Date(valor);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * Recebimento manual de avulsa (ADR-07 RF-21): total ou parcial, com data e
 * método. Default = saldo restante (já agregado pelo banco em
 * `recebido_cents`). Auditoria nasce na RPC (`receivable_settle`); NUNCA cria
 * linha em `appointment_payments`.
 *
 * Pré-validação local de saldo: a RPC também recusa (`RECEIVABLE_OVERPAY`), mas
 * o usuário recebe o motivo no campo antes do round-trip. Conta com PIX vivo não
 * aceita baixa manual (a RPC responde `RECEIVABLE_HAS_ACTIVE_CHARGE`).
 */
export function ReceberDialog({ conta, aoFechar }: ReceberDialogProps) {
  const aberto = conta !== null;
  const receber = useSettleReceivable();
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const recebido = conta?.recebido_cents ?? 0;
  const resto = conta ? restoReceivable(conta.valor_cents, recebido) : 0;
  const temPixVivo = conta ? receivableHasActiveCharge(conta) : false;

  const form = useForm<RecebimentoInput>({
    resolver: zodResolver(recebimentoSchema),
    defaultValues: { valorReais: "", recebidoEm: agoraLocalInput(), metodo: "pix" },
  });

  useEffect(() => {
    if (!conta) {
      form.reset();
      setErro(null);
      setAviso(null);
      return;
    }
    const restante = restoReceivable(conta.valor_cents, conta.recebido_cents);
    form.reset({
      valorReais: (restante / 100).toFixed(2).replace(".", ","),
      recebidoEm: agoraLocalInput(),
      metodo: "pix",
    });
    setErro(null);
    setAviso(null);
  }, [conta, form]);

  async function onSubmit(values: RecebimentoInput) {
    if (!conta) return;
    setErro(null);
    setAviso(null);
    const cents = parseBRLToCents(values.valorReais);
    if (cents === null || cents <= 0) {
      form.setError("valorReais", { message: "Informe um valor maior que zero." });
      return;
    }
    // Pré-validação: nunca deixar o usuário descobrir o saldo por PT409.
    if (cents > resto) {
      form.setError("valorReais", {
        message: `O valor excede o saldo de ${formatCentsToBRL(resto)}.`,
      });
      return;
    }
    if (temPixVivo) {
      setErro(
        "Esta conta tem um PIX em aberto. Cancele o PIX antes de registrar recebimento manual.",
      );
      return;
    }
    const recebidoEm = localParaIso(values.recebidoEm);
    if (!recebidoEm) {
      form.setError("recebidoEm", { message: "Informe uma data válida." });
      return;
    }
    try {
      const result = await receber.mutateAsync({
        receivable_id: conta.id,
        valor_cents: cents,
        recebido_at: recebidoEm,
        metodo: values.metodo,
      });
      if (result.status === "pago") {
        aoFechar();
        return;
      }
      setAviso(`Recebimento parcial registrado. Saldo: ${formatCentsToBRL(result.resto_cents)}.`);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível registrar o recebimento.");
    }
  }

  return (
    <Dialog open={aberto} onOpenChange={(v) => (v ? undefined : aoFechar())}>
      <DialogContent className="sm:max-w-md" aria-label="Registrar recebimento">
        <DialogHeader>
          <DialogTitle>Registrar recebimento</DialogTitle>
          <DialogDescription>
            {conta
              ? `${conta.descricao} · saldo ${formatCentsToBRL(resto)} de ${formatCentsToBRL(conta.valor_cents)}.`
              : ""}
          </DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={form.handleSubmit(onSubmit)} noValidate>
          {temPixVivo ? (
            <p role="alert" className="text-sm text-destructive">
              PIX em aberto nesta conta. Cancele o PIX na lista antes de registrar um
              recebimento manual.
            </p>
          ) : null}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="receber-valor">Valor recebido (R$)</Label>
              <Input id="receber-valor" inputMode="decimal" {...form.register("valorReais")} />
              {form.formState.errors.valorReais ? (
                <p className="text-sm text-destructive">{form.formState.errors.valorReais.message}</p>
              ) : null}
            </div>
            <div className="space-y-2">
              <Label htmlFor="receber-data">Recebido em</Label>
              <Input id="receber-data" type="datetime-local" {...form.register("recebidoEm")} />
              {form.formState.errors.recebidoEm ? (
                <p className="text-sm text-destructive">{form.formState.errors.recebidoEm.message}</p>
              ) : null}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="receber-metodo">Método</Label>
            <select
              id="receber-metodo"
              className="flex h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              {...form.register("metodo")}
            >
              {RECEBIMENTO_METODOS.map((metodo) => (
                <option key={metodo} value={metodo}>
                  {RECEBIMENTO_METODO_META[metodo]}
                </option>
              ))}
            </select>
          </div>

          {aviso ? (
            <p role="status" className="text-sm text-foreground">
              {aviso}
            </p>
          ) : null}
          {erro ? (
            <p role="alert" className="text-sm text-destructive">
              {erro}
            </p>
          ) : null}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={aoFechar}>
              Fechar
            </Button>
            <Button
              type="submit"
              className="min-h-11"
              disabled={receber.isPending || temPixVivo}
            >
              {receber.isPending ? "Registrando…" : "Registrar recebimento"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
