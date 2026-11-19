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
import { useCreateSupplier } from "@/hooks/usePayables";
import { novoFornecedorSchema, type NovoFornecedorInput } from "@/lib/pagar";

interface NovoFornecedorDialogProps {
  aberto: boolean;
  aoAlterarAberto: (v: boolean) => void;
  /** Quando o fornecedor é criado, devolve o id para pré-selecionar no lançamento. */
  aoCriar?: (id: string) => void;
}

/**
 * Fornecedor curto (ADR-06 RF-13): nome + documento + contato opcionais.
 * Escrita só via RPC `payable_create_supplier` (admin, RLS no banco).
 */
export function NovoFornecedorDialog({ aberto, aoAlterarAberto, aoCriar }: NovoFornecedorDialogProps) {
  const criar = useCreateSupplier();
  const [erro, setErro] = useState<string | null>(null);
  const form = useForm<NovoFornecedorInput>({
    resolver: zodResolver(novoFornecedorSchema),
    defaultValues: { nome: "", documento: "", contato: "" },
  });

  async function onSubmit(values: NovoFornecedorInput) {
    setErro(null);
    try {
      const id = await criar.mutateAsync({
        nome: values.nome.trim(),
        documento: values.documento?.trim() || undefined,
        contato: values.contato?.trim() || undefined,
      });
      form.reset();
      criar.reset();
      aoCriar?.(id);
      aoAlterarAberto(false);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível cadastrar o fornecedor.");
    }
  }

  return (
    <Dialog open={aberto} onOpenChange={aoAlterarAberto}>
      <DialogContent className="sm:max-w-md" aria-label="Cadastrar fornecedor">
        <DialogHeader>
          <DialogTitle>Novo fornecedor</DialogTitle>
          <DialogDescription>Cadastro rápido: só o nome é obrigatório.</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={form.handleSubmit(onSubmit)}
          noValidate
        >
          <div className="space-y-2">
            <Label htmlFor="fornecedor-nome">Nome</Label>
            <Input
              id="fornecedor-nome"
              autoComplete="off"
              placeholder="Ex.: Distribuidora Central"
              {...form.register("nome")}
            />
            {form.formState.errors.nome ? (
              <p className="text-sm text-destructive">{form.formState.errors.nome.message}</p>
            ) : null}
          </div>
          <div className="space-y-2">
            <Label htmlFor="fornecedor-documento">Documento (opcional)</Label>
            <Input
              id="fornecedor-documento"
              autoComplete="off"
              inputMode="numeric"
              placeholder="CNPJ ou CPF"
              {...form.register("documento")}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="fornecedor-contato">Contato (opcional)</Label>
            <Input
              id="fornecedor-contato"
              autoComplete="off"
              placeholder="Telefone ou e-mail"
              {...form.register("contato")}
            />
          </div>
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
              {criar.isPending ? "Salvando…" : "Cadastrar"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
