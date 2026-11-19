import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

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
import { useImportStatement } from "@/hooks/useConciliacao";
import { CONCILIACAO_FORMATOS, formatarDataExtrato, type BankAccount } from "@/lib/conciliacao";
import { formatCentsToBRL } from "@/lib/money";

interface UploadExtratoDialogProps {
  aberto: boolean;
  conta: BankAccount | null;
  aoAlterarAberto: (aberto: boolean) => void;
}

const FORMATO_POR_EXTENSAO: Record<string, "ofx" | "csv"> = {
  ofx: "ofx",
  csv: "csv",
};

/**
 * Import de extrato OFX/CSV (ADR-08, RF-22). O arquivo é lido como texto no
 * cliente e enviado à Edge `import-statement`, que parseia, calcula o hash
 * (replay não duplica) e grava de forma atômica. Arquivo inválido volta com
 * mensagem legível em pt-BR — nunca grava linha parcial.
 *
 * LGPD: o arquivo não é logado; o nome do arquivo vai para o registro do extrato
 * (metadado do próprio tenant), e a conta é exibida só pelos últimos 4 dígitos.
 */
export function UploadExtratoDialog({ aberto, conta, aoAlterarAberto }: UploadExtratoDialogProps) {
  const importar = useImportStatement();
  const [formato, setFormato] = useState<"ofx" | "csv">("ofx");
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!aberto) {
      setArquivo(null);
      setErro(null);
      setFormato("ofx");
      importar.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aberto]);

  function aoEscolher(file: File | null) {
    setArquivo(file);
    setErro(null);
    if (!file) return;
    const extensao = file.name.split(".").pop()?.toLowerCase() ?? "";
    const detectado = FORMATO_POR_EXTENSAO[extensao];
    if (detectado) setFormato(detectado);
  }

  async function onImportar() {
    if (!conta) {
      setErro("Cadastre a conta bancária antes de importar.");
      return;
    }
    if (!arquivo) {
      setErro("Escolha o arquivo OFX ou CSV.");
      return;
    }
    setErro(null);
    try {
      const conteudo = await arquivo.text();
      const resultado = await importar.mutateAsync({
        account_id: conta.id,
        formato,
        nome_arquivo: arquivo.name,
        conteudo,
      });
      toast.success(
        resultado.replayed
          ? "Este extrato já havia sido importado."
          : `Extrato importado com ${resultado.linhas_total} lançamento(s).`,
        {
          description: `Período ${formatarDataExtrato(resultado.periodo_ini)} a ${formatarDataExtrato(resultado.periodo_fim)}${
            resultado.saldo_fim_cents === null
              ? ""
              : ` · saldo final ${formatCentsToBRL(resultado.saldo_fim_cents)}`
          }.`,
        },
      );
      aoAlterarAberto(false);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível importar o extrato.");
    }
  }

  return (
    <Dialog open={aberto} onOpenChange={aoAlterarAberto}>
      <DialogContent className="sm:max-w-lg" aria-label="Importar extrato bancário">
        <DialogHeader>
          <DialogTitle>Importar extrato</DialogTitle>
          <DialogDescription>
            {conta
              ? `${conta.nome} · ${conta.banco} · final ${conta.conta_ultimos4}. O saldo do arquivo entra no extrato; reenviar o mesmo arquivo não duplica nada.`
              : "Cadastre a conta bancária antes de importar."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="conciliacao-formato">Formato</Label>
            <select
              id="conciliacao-formato"
              className="flex h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              value={formato}
              onChange={(e) => setFormato(e.target.value === "csv" ? "csv" : "ofx")}
            >
              {CONCILIACAO_FORMATOS.map((f) => (
                <option key={f} value={f}>
                  {f.toUpperCase()}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="conciliacao-arquivo">Arquivo do banco</Label>
            <Input
              ref={inputRef}
              id="conciliacao-arquivo"
              type="file"
              accept=".ofx,.csv,text/plain"
              onChange={(e) => aoEscolher(e.target.files?.[0] ?? null)}
            />
            <p className="text-xs text-muted-foreground">
              OFX do internet banking ou CSV com cabeçalho data, descrição e valor.
            </p>
          </div>
        </div>

        {erro ? (
          <p role="alert" className="text-sm text-destructive">
            {erro}
          </p>
        ) : null}

        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            className="min-h-11"
            onClick={() => aoAlterarAberto(false)}
          >
            Voltar
          </Button>
          <Button
            type="button"
            className="min-h-11"
            disabled={importar.isPending || conta === null}
            onClick={() => void onImportar()}
          >
            {importar.isPending ? "Importando…" : "Importar extrato"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
