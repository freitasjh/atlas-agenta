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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useCreateBankAccount } from "@/hooks/useConciliacao";
import { contaBancariaSchema } from "@/lib/conciliacao";
import { parseBRLToCents } from "@/lib/money";

interface ContaBancariaDialogProps {
  aberto: boolean;
  aoAlterarAberto: (aberto: boolean) => void;
}

/**
 * Cadastro da conta bancária (ADR-08). LGPD: guarda só os 4 últimos dígitos —
 * agência/conta completa nunca é pedida nem persistida. Replay da mesma
 * conta (banco + finais) devolve a existente, sem duplicar.
 */
export function ContaBancariaDialog({ aberto, aoAlterarAberto }: ContaBancariaDialogProps) {
  const criar = useCreateBankAccount();
  const [nome, setNome] = useState("");
  const [banco, setBanco] = useState("");
  const [ultimos4, setUltimos4] = useState("");
  const [saldoInicial, setSaldoInicial] = useState("");
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (!aberto) {
      setNome("");
      setBanco("");
      setUltimos4("");
      setSaldoInicial("");
      setErro(null);
      criar.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aberto]);

  async function onSalvar() {
    const parsed = contaBancariaSchema.safeParse({
      nome,
      banco,
      conta_ultimos4: ultimos4,
      saldo_inicial: saldoInicial,
    });
    if (!parsed.success) {
      setErro(parsed.error.issues[0]?.message ?? "Confira os dados da conta.");
      return;
    }
    const saldoCents = parsed.data.saldo_inicial === ""
      ? 0
      : parseBRLToCents(parsed.data.saldo_inicial);
    if (saldoCents === null) {
      setErro("Saldo inicial inválido.");
      return;
    }

    setErro(null);
    try {
      const resultado = await criar.mutateAsync({
        nome: parsed.data.nome,
        banco: parsed.data.banco,
        conta_ultimos4: parsed.data.conta_ultimos4,
        saldo_inicial_cents: saldoCents,
      });
      toast.success(
        resultado.replayed ? "Esta conta já estava cadastrada." : "Conta bancária cadastrada.",
      );
      aoAlterarAberto(false);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível cadastrar a conta.");
    }
  }

  return (
    <Dialog open={aberto} onOpenChange={aoAlterarAberto}>
      <DialogContent className="sm:max-w-md" aria-label="Cadastrar conta bancária">
        <DialogHeader>
          <DialogTitle>Conta bancária</DialogTitle>
          <DialogDescription>
            Guardamos apenas os 4 últimos dígitos. Nome e banco identificam a conta na tela.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="conciliacao-conta-nome">Nome da conta</Label>
            <Input
              id="conciliacao-conta-nome"
              value={nome}
              maxLength={120}
              placeholder="Ex.: Conta principal"
              onChange={(e) => setNome(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="conciliacao-conta-banco">Banco</Label>
            <Input
              id="conciliacao-conta-banco"
              value={banco}
              maxLength={60}
              placeholder="Ex.: Banco do Brasil"
              onChange={(e) => setBanco(e.target.value)}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="conciliacao-conta-final">Final da conta</Label>
              <Input
                id="conciliacao-conta-final"
                inputMode="numeric"
                value={ultimos4}
                maxLength={4}
                placeholder="1234"
                onChange={(e) => setUltimos4(e.target.value.replace(/\D/g, "").slice(0, 4))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="conciliacao-conta-saldo">Saldo inicial (R$)</Label>
              <Input
                id="conciliacao-conta-saldo"
                inputMode="decimal"
                value={saldoInicial}
                placeholder="0,00"
                onChange={(e) => setSaldoInicial(e.target.value)}
              />
            </div>
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
            disabled={criar.isPending}
            onClick={() => void onSalvar()}
          >
            {criar.isPending ? "Salvando…" : "Salvar conta"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
