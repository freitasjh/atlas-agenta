import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useCreatePayable, useSuppliers } from "@/hooks/usePayables";
import { novoLancamentoSchema, type NovoLancamentoInput } from "@/lib/pagar";
import { parseBRLToCents } from "@/lib/money";
import { NovoFornecedorDialog } from "@/app/financeiro/pagar/NovoFornecedorDialog";

interface NovoLancamentoDialogProps {
  aberto: boolean;
  aoAlterarAberto: (v: boolean) => void;
}

/** Converte `datetime-local` (fuso local) para ISO UTC; vazio → `null`. */
function localParaIso(valor: string): string | null {
  const d = new Date(valor);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * Novo lançamento (ADR-06 RF-14): descrição, fornecedor, categoria, vencimento,
 * valor em reais (vira `*_cents`), Switch de recorrência mensal (2–24 parcelas).
 * Recorrência gera série com `serie_id`; replay não duplica (banco).
 */
export function NovoLancamentoDialog({ aberto, aoAlterarAberto }: NovoLancamentoDialogProps) {
  const fornecedores = useSuppliers(aberto);
  const criar = useCreatePayable();
  const [erro, setErro] = useState<string | null>(null);
  const [fornecedorAberto, setFornecedorAberto] = useState(false);
  const form = useForm<NovoLancamentoInput>({
    resolver: zodResolver(novoLancamentoSchema),
    defaultValues: {
      descricao: "",
      categoria: "",
      supplier_id: null,
      vencimento: "",
      valorReais: "",
      recorrencia: "none",
      parcelas: 3,
    },
  });
  const recorrente = form.watch("recorrencia") === "mensal";

  async function onSubmit(values: NovoLancamentoInput) {
    setErro(null);
    const cents = parseBRLToCents(values.valorReais);
    if (cents === null || cents <= 0) {
      form.setError("valorReais", { message: "Informe um valor maior que zero." });
      return;
    }
    const vencimento = localParaIso(values.vencimento);
    if (!vencimento) {
      form.setError("vencimento", { message: "Informe um vencimento válido." });
      return;
    }
    try {
      await criar.mutateAsync({
        descricao: values.descricao.trim(),
        vencimento_at: vencimento,
        valor_cents: cents,
        supplier_id: values.supplier_id ?? null,
        categoria: values.categoria?.trim() || null,
        recorrencia: values.recorrencia,
        parcelas: values.recorrencia === "mensal" ? values.parcelas : 1,
      });
      form.reset();
      criar.reset();
      aoAlterarAberto(false);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível lançar a conta.");
    }
  }

  return (
    <>
      <Dialog open={aberto} onOpenChange={aoAlterarAberto}>
        <DialogContent className="sm:max-w-md" aria-label="Lançar conta a pagar">
          <DialogHeader>
            <DialogTitle>Nova conta a pagar</DialogTitle>
            <DialogDescription>Fornecedor, vencimento e valor. A recorrência mensal gera as parcelas de uma vez.</DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={form.handleSubmit(onSubmit)} noValidate>
            <div className="space-y-2">
              <Label htmlFor="lancamento-descricao">Descrição</Label>
              <Input
                id="lancamento-descricao"
                autoComplete="off"
                placeholder="Ex.: Aluguel do salão"
                {...form.register("descricao")}
              />
              {form.formState.errors.descricao ? (
                <p className="text-sm text-destructive">{form.formState.errors.descricao.message}</p>
              ) : null}
            </div>
            <div className="space-y-2">
              <Label htmlFor="lancamento-fornecedor">Fornecedor (opcional)</Label>
              <div className="flex gap-2">
                <select
                  id="lancamento-fornecedor"
                  className="flex h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  {...form.register("supplier_id", {
                    setValueAs: (v: string) => (v === "" ? null : v),
                  })}
                >
                  <option value="">Sem fornecedor</option>
                  {(fornecedores.data ?? []).map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.nome}
                    </option>
                  ))}
                </select>
                <Button
                  type="button"
                  variant="outline"
                  className="min-h-11 shrink-0"
                  onClick={() => setFornecedorAberto(true)}
                >
                  Novo
                </Button>
              </div>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="lancamento-vencimento">Vencimento</Label>
                <Input id="lancamento-vencimento" type="datetime-local" {...form.register("vencimento")} />
                {form.formState.errors.vencimento ? (
                  <p className="text-sm text-destructive">{form.formState.errors.vencimento.message}</p>
                ) : null}
              </div>
              <div className="space-y-2">
                <Label htmlFor="lancamento-valor">Valor (R$)</Label>
                <Input
                  id="lancamento-valor"
                  autoComplete="off"
                  inputMode="decimal"
                  placeholder="0,00"
                  {...form.register("valorReais")}
                />
                {form.formState.errors.valorReais ? (
                  <p className="text-sm text-destructive">{form.formState.errors.valorReais.message}</p>
                ) : null}
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="lancamento-categoria">Categoria (opcional)</Label>
              <Input
                id="lancamento-categoria"
                autoComplete="off"
                placeholder="Ex.: fixo, insumos"
                {...form.register("categoria")}
              />
            </div>
            <div className="flex items-center justify-between gap-3 rounded-md border px-3 py-2">
              <div className="space-y-0.5">
                <Label htmlFor="lancamento-recorrencia">Recorrência mensal</Label>
                <p className="text-xs text-muted-foreground">Gera as parcelas da série de uma vez, sem duplicar.</p>
              </div>
              <Switch
                id="lancamento-recorrencia"
                checked={recorrente}
                onCheckedChange={(v) => form.setValue("recorrencia", v ? "mensal" : "none")}
              />
            </div>
            {recorrente ? (
              <div className="space-y-2">
                <Label htmlFor="lancamento-parcelas">Parcelas (2 a 24)</Label>
                <Input id="lancamento-parcelas" type="number" min={2} max={24} {...form.register("parcelas")} />
                {form.formState.errors.parcelas ? (
                  <p className="text-sm text-destructive">{form.formState.errors.parcelas.message}</p>
                ) : null}
              </div>
            ) : null}
            {erro ? (
              <p role="alert" className="text-sm text-destructive">
                {erro}
              </p>
            ) : null}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" className="min-h-11" onClick={() => aoAlterarAberto(false)}>
                Cancelar
              </Button>
              <Button type="submit" className="min-h-11" disabled={criar.isPending}>
                {criar.isPending ? "Lançando…" : "Lançar"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
      <NovoFornecedorDialog
        aberto={fornecedorAberto}
        aoAlterarAberto={setFornecedorAberto}
        aoCriar={(id) => form.setValue("supplier_id", id)}
      />
    </>
  );
}
