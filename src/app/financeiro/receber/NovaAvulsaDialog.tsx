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
import { useCustomers } from "@/hooks/useCustomers";
import { useCreateReceivable } from "@/hooks/useReceivables";
import { parseBRLToCents } from "@/lib/money";
import { novaAvulsaSchema, type NovaAvulsaInput } from "@/lib/receber";

interface NovaAvulsaDialogProps {
  aberto: boolean;
  aoAlterarAberto: (v: boolean) => void;
}

/** Converte `datetime-local` (fuso local) para ISO UTC; vazio/inválido → `null`. */
function localParaIso(valor: string): string | null {
  const d = new Date(valor);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * Nova cobrança avulsa (ADR-07 RF-19): cliente, descrição, categoria (default
 * `avulsa`, usada pelo DRE), vencimento e valor em reais (vira `*_cents`).
 * Nasce `pendente`; PIX/WhatsApp são acionados depois, na tabela.
 */
export function NovaAvulsaDialog({ aberto, aoAlterarAberto }: NovaAvulsaDialogProps) {
  const clientes = useCustomers({ activeOnly: true, enabled: aberto });
  const criar = useCreateReceivable();
  const [erro, setErro] = useState<string | null>(null);

  const form = useForm<NovaAvulsaInput>({
    resolver: zodResolver(novaAvulsaSchema),
    defaultValues: {
      customer_id: "",
      descricao: "",
      categoria: "avulsa",
      vencimento: "",
      valorReais: "",
    },
  });

  useEffect(() => {
    if (!aberto) {
      form.reset();
      setErro(null);
    }
  }, [aberto, form]);

  async function onSubmit(values: NovaAvulsaInput) {
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
        customer_id: values.customer_id,
        descricao: values.descricao.trim(),
        categoria: values.categoria?.trim() || "avulsa",
        vencimento_at: vencimento,
        valor_cents: cents,
      });
      criar.reset();
      aoAlterarAberto(false);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível criar a cobrança.");
    }
  }

  return (
    <Dialog open={aberto} onOpenChange={aoAlterarAberto}>
      <DialogContent className="sm:max-w-md" aria-label="Nova cobrança avulsa">
        <DialogHeader>
          <DialogTitle>Nova cobrança avulsa</DialogTitle>
          <DialogDescription>
            Cobrança fora do ledger de atendimentos, com categoria própria no DRE.
          </DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={form.handleSubmit(onSubmit)} noValidate>
          <div className="space-y-2">
            <Label htmlFor="avulsa-cliente">Cliente</Label>
            <select
              id="avulsa-cliente"
              className="flex h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              {...form.register("customer_id")}
            >
              <option value="">Selecione o cliente</option>
              {(clientes.data ?? []).map((cliente) => (
                <option key={cliente.id} value={cliente.id}>
                  {cliente.name}
                </option>
              ))}
            </select>
            {form.formState.errors.customer_id ? (
              <p className="text-sm text-destructive">{form.formState.errors.customer_id.message}</p>
            ) : null}
          </div>

          <div className="space-y-2">
            <Label htmlFor="avulsa-descricao">Descrição</Label>
            <Input
              id="avulsa-descricao"
              autoComplete="off"
              placeholder="Ex.: Produto vendido fora do caixa"
              {...form.register("descricao")}
            />
            {form.formState.errors.descricao ? (
              <p className="text-sm text-destructive">{form.formState.errors.descricao.message}</p>
            ) : null}
          </div>

          <div className="space-y-2">
            <Label htmlFor="avulsa-categoria">Categoria</Label>
            <Input id="avulsa-categoria" autoComplete="off" {...form.register("categoria")} />
            <p className="text-xs text-muted-foreground">
              Agrupa a receita avulsa no DRE, separada do ledger de atendimento.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="avulsa-vencimento">Vencimento</Label>
              <Input
                id="avulsa-vencimento"
                type="datetime-local"
                {...form.register("vencimento")}
              />
              {form.formState.errors.vencimento ? (
                <p className="text-sm text-destructive">{form.formState.errors.vencimento.message}</p>
              ) : null}
            </div>
            <div className="space-y-2">
              <Label htmlFor="avulsa-valor">Valor (R$)</Label>
              <Input
                id="avulsa-valor"
                inputMode="decimal"
                placeholder="0,00"
                {...form.register("valorReais")}
              />
              {form.formState.errors.valorReais ? (
                <p className="text-sm text-destructive">{form.formState.errors.valorReais.message}</p>
              ) : null}
            </div>
          </div>

          {erro ? (
            <p role="alert" className="text-sm text-destructive">
              {erro}
            </p>
          ) : null}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => aoAlterarAberto(false)}>
              Cancelar
            </Button>
            <Button type="submit" className="min-h-11" disabled={criar.isPending}>
              {criar.isPending ? "Criando…" : "Criar cobrança"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
