import { useEffect, useId, useState } from "react";
import { Copy } from "lucide-react";

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
import { useChargeReceivable } from "@/hooks/useReceivables";
import { formatCentsToBRL } from "@/lib/money";
import {
  receivableChargeExpired,
  type CobrancaResponse,
  type Receivable,
} from "@/lib/receber";

interface CobrancaDialogProps {
  conta: Receivable | null;
  aoFechar: () => void;
}

function normalizarQrCode(valor: string | null): string | null {
  if (!valor) return null;
  return valor.startsWith("data:") ? valor : `data:image/png;base64,${valor}`;
}

/**
 * Cobrança da avulsa (ADR-07 RF-19/21): gera o PIX no Asaas (idempotente — a
 * segunda chamada reaproveita a cobrança) e, opcionalmente, enfileira a cobrança
 * no WhatsApp somente com opt-in. Sem opt-in a Edge responde 422 e nada é
 * criado; a mensagem de erro aparece aqui em pt-BR.
 */
export function CobrancaDialog({ conta, aoFechar }: CobrancaDialogProps) {
  const aberto = conta !== null;
  const cobrar = useChargeReceivable();
  const [resultado, setResultado] = useState<CobrancaResponse | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [copiado, setCopiado] = useState<"ok" | "erro" | null>(null);
  const copiaId = useId();

  useEffect(() => {
    if (!aberto) {
      setResultado(null);
      setErro(null);
      setCopiado(null);
      cobrar.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aberto]);

  async function acionar(notify: boolean) {
    if (!conta) return;
    setErro(null);
    setCopiado(null);
    try {
      const data = await cobrar.mutateAsync({
        receivable_id: conta.id,
        notify_whatsapp: notify,
      });
      setResultado(data);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível gerar a cobrança PIX.");
    }
  }

  const qr = normalizarQrCode(resultado?.pix_qr_code ?? null);

  async function copiar() {
    try {
      await navigator.clipboard.writeText(resultado?.pix_copy_paste ?? "");
      setCopiado("ok");
    } catch {
      setCopiado("erro");
    }
  }

  return (
    <Dialog open={aberto} onOpenChange={(v) => (v ? undefined : aoFechar())}>
      <DialogContent className="sm:max-w-md" aria-label="Cobrar conta avulsa">
        <DialogHeader>
          <DialogTitle>Cobrar {conta?.descricao ?? "conta avulsa"}</DialogTitle>
          <DialogDescription>
            {conta
              ? `Valor ${formatCentsToBRL(conta.valor_cents)} · vencimento ${new Date(conta.vencimento_at).toLocaleDateString("pt-BR")}. ${
                  receivableChargeExpired(conta)
                    ? "O PIX anterior venceu: ele será cancelado e um novo será emitido."
                    : "O PIX é reaproveitado se já existir."
                }`
              : ""}
          </DialogDescription>
        </DialogHeader>

        {resultado ? (
          <div className="space-y-3">
            {qr ? (
              <div className="flex justify-center">
                <img src={qr} alt="QR Code do PIX" className="h-48 w-48 rounded-md bg-white p-2" />
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                O gateway não devolveu a imagem do QR. Use o PIX copia e cola.
              </p>
            )}

            <div className="space-y-1">
              <label htmlFor={copiaId} className="text-sm font-medium">
                PIX copia e cola
              </label>
              <div className="flex gap-2">
                <Input
                  id={copiaId}
                  readOnly
                  value={resultado.pix_copy_paste ?? ""}
                  aria-label="PIX copia e cola"
                />
                <Button
                  type="button"
                  variant="outline"
                  className="min-h-11"
                  onClick={() => void copiar()}
                >
                  <Copy className="mr-2 h-4 w-4" aria-hidden="true" />
                  Copiar
                </Button>
              </div>
              {copiado === "ok" ? (
                <p role="status" className="text-sm text-muted-foreground">
                  Código copiado.
                </p>
              ) : null}
              {copiado === "erro" ? (
                <p role="alert" className="text-sm text-destructive">
                  Não foi possível copiar. Selecione o código manualmente.
                </p>
              ) : null}
            </div>

            <p role="status" className="text-sm text-muted-foreground">
              {resultado.whatsapp?.queued
                ? "Mensagem de cobrança enfileirada no WhatsApp."
                : resultado.whatsapp?.requested
                  ? "Mensagem já estava enfileirada para este PIX."
                  : "PIX pronto. Nenhuma mensagem de WhatsApp foi enviada."}
              {resultado.reused ? " Cobrança existente reaproveitada." : ""}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Gere o PIX para o cliente pagar. O envio por WhatsApp depende do
              consentimento (opt-in) registrado no cadastro do cliente.
            </p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button
                type="button"
                className="min-h-11 flex-1"
                disabled={cobrar.isPending}
                onClick={() => void acionar(false)}
              >
                {cobrar.isPending ? "Gerando…" : "Gerar PIX"}
              </Button>
              <Button
                type="button"
                variant="outline"
                className="min-h-11 flex-1"
                disabled={cobrar.isPending}
                onClick={() => void acionar(true)}
              >
                Cobrar no WhatsApp
              </Button>
            </div>
          </div>
        )}

        {erro ? (
          <p role="alert" className="text-sm text-destructive">
            {erro}
          </p>
        ) : null}

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={aoFechar}>
            Fechar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
