import { useEffect, useMemo, useState } from "react";
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
import { useCreateEntry } from "@/hooks/useConciliacao";
import { useCustomers } from "@/hooks/useCustomers";
import { useSuppliers } from "@/hooks/usePayables";
import {
  formatarDataExtrato,
  isDebito,
  valorAssinado,
  type BankLine,
} from "@/lib/conciliacao";
import { formatCentsToBRL } from "@/lib/money";

interface CriarLancamentoDialogProps {
  linha: BankLine | null;
  liberado: boolean;
  aoFechar: () => void;
}

/**
 * Cria o lançamento a partir de uma linha ÓRFÃ (ADR-08, RF-24). A direção é
 * derivada do sinal do extrato — débito vira conta a pagar, crédito vira conta a
 * receber — e o vínculo nasce junto (a linha vira `conciliado` na mesma
 * transação do banco). Crédito exige cliente (conta a receber precisa de dono).
 */
export function CriarLancamentoDialog({ linha, liberado, aoFechar }: CriarLancamentoDialogProps) {
  const criar = useCreateEntry();
  const fornecedores = useSuppliers(liberado && linha !== null && isDebito(linha.valor_cents));
  const clientes = useCustomers({
    activeOnly: true,
    enabled: liberado && linha !== null && linha.valor_cents > 0,
  });

  const [supplierId, setSupplierId] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [categoria, setCategoria] = useState("");
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (linha === null) {
      setSupplierId("");
      setCustomerId("");
      setCategoria("");
      setErro(null);
      criar.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linha]);

  const tipo = useMemo(() => {
    if (!linha) return null;
    return isDebito(linha.valor_cents) ? "payable" : "receivable";
  }, [linha]);

  async function onConfirmar() {
    if (!linha || tipo === null) return;
    if (tipo === "receivable" && customerId === "") {
      setErro("Selecione o cliente da conta a receber.");
      return;
    }
    setErro(null);
    try {
      const resultado = await criar.mutateAsync({
        bank_line_id: linha.id,
        supplier_id: tipo === "payable" && supplierId !== "" ? supplierId : null,
        customer_id: tipo === "receivable" ? customerId : null,
        categoria: categoria.trim() === "" ? null : categoria.trim(),
      });
      toast.success(
        resultado.alvo_tipo === "payable"
          ? "Conta a pagar criada e conciliada."
          : "Conta a receber criada e conciliada.",
        { description: "O vínculo não pode ser desfeito: cancele o lançamento se precisar." },
      );
      aoFechar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível criar o lançamento.");
    }
  }

  return (
    <Dialog open={linha !== null} onOpenChange={(v) => (v ? undefined : aoFechar())}>
      <DialogContent className="sm:max-w-md" aria-label="Criar lançamento a partir do extrato">
        <DialogHeader>
          <DialogTitle>
            {tipo === "payable" ? "Criar conta a pagar" : "Criar conta a receber"}
          </DialogTitle>
          <DialogDescription>
            {linha
              ? `${formatarDataExtrato(linha.data)} · ${linha.descricao} · ${valorAssinado(
                  linha.valor_cents,
                )}. O lançamento nasce com ${formatCentsToBRL(Math.abs(linha.valor_cents))} e o vínculo é criado junto.`
              : null}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {tipo === "payable" ? (
            <div className="space-y-2">
              <Label htmlFor="conciliacao-fornecedor">Fornecedor (opcional)</Label>
              <select
                id="conciliacao-fornecedor"
                className="flex h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                value={supplierId}
                onChange={(e) => setSupplierId(e.target.value)}
              >
                <option value="">Sem fornecedor</option>
                {(fornecedores.data ?? []).map((fornecedor) => (
                  <option key={fornecedor.id} value={fornecedor.id}>
                    {fornecedor.nome}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <div className="space-y-2">
              <Label htmlFor="conciliacao-cliente">Cliente</Label>
              <select
                id="conciliacao-cliente"
                className="flex h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                value={customerId}
                onChange={(e) => setCustomerId(e.target.value)}
              >
                <option value="">Selecione o cliente</option>
                {(clientes.data ?? []).map((cliente) => (
                  <option key={cliente.id} value={cliente.id}>
                    {cliente.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="conciliacao-categoria">Categoria (opcional)</Label>
            <Input
              id="conciliacao-categoria"
              value={categoria}
              maxLength={60}
              placeholder="Ex.: material, tarifa, serviço"
              onChange={(e) => setCategoria(e.target.value)}
            />
          </div>
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
            disabled={criar.isPending}
            onClick={() => void onConfirmar()}
          >
            {criar.isPending ? "Criando…" : "Criar e conciliar"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
