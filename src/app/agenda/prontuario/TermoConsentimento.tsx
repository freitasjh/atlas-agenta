import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { formatDateInTenantTz } from "@/lib/datetime";
import { TERMO_TEXTO, type TermoMetodo } from "@/app/agenda/prontuario/consentimento";
import {
  mapConsentimentoError,
  useAssinarTermo,
  useTermoConsentimento,
} from "@/app/agenda/prontuario/useTermoConsentimento";

interface TermoConsentimentoProps {
  customerId: string;
  timeZone: string;
  canWrite: boolean;
  enabled: boolean;
  onStatusChange: (consented: boolean) => void;
}

/**
 * Termo de consentimento (UX-SPEC T1 item 6 + emenda B2): status + `Dialog`
 * com texto, canvas de assinatura e campo alternativo "Nome completo (vale
 * como assinatura)". Conclui só com checkbox LGPD (nunca pré-marcado) +
 * (traço OU nome). Assinado exibe nome/data/hash e é imutável.
 */
export function TermoConsentimento({
  customerId,
  timeZone,
  canWrite,
  enabled,
  onStatusChange,
}: TermoConsentimentoProps) {
  const termoQuery = useTermoConsentimento({ customerId, enabled });
  const assinar = useAssinarTermo();
  const termo = termoQuery.data ?? null;

  const [dialogOpen, setDialogOpen] = useState(false);
  const [nome, setNome] = useState("");
  const [aceite, setAceite] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [tracos, setTracos] = useState<number>(0);
  const desenhandoRef = useRef(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    onStatusChange(termo !== null);
  }, [termo, onStatusChange]);

  useEffect(() => {
    if (dialogOpen) {
      setNome("");
      setAceite(false);
      setErro(null);
      setTracos(0);
    }
  }, [dialogOpen]);

  function pintarAte(clientX: number, clientY: number) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.fillStyle = "currentColor";
      ctx.beginPath();
      ctx.arc(clientX - rect.left, clientY - rect.top, 2, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function handlePointerDown(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!canWrite) return;
    desenhandoRef.current = true;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setTracos((count) => count + 1);
    pintarAte(event.clientX, event.clientY);
  }

  function handlePointerMove(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!desenhandoRef.current) return;
    setTracos((count) => count + 1);
    pintarAte(event.clientX, event.clientY);
  }

  function handlePointerUp() {
    desenhandoRef.current = false;
  }

  async function handleConfirmar() {
    const nomePreenchido = nome.trim() !== "";
    if (!aceite || (tracos === 0 && !nomePreenchido)) {
      setErro("Para concluir: marque o aceite e assine no quadro ou informe o nome completo.");
      return;
    }
    setErro(null);
    const method: TermoMetodo =
      tracos > 0 && nomePreenchido ? "ambos" : tracos > 0 ? "traco" : "nome";
    try {
      await assinar.mutateAsync({
        customerId,
        signerName: nomePreenchido ? nome.trim() : "Assinatura manuscrita no quadro",
        method,
      });
      setDialogOpen(false);
      toast.success("Termo registrado.");
    } catch (error) {
      setErro(mapConsentimentoError(error));
    }
  }

  return (
    <section aria-label="Termo de consentimento" className="space-y-3">
      <h4 className="text-sm font-semibold text-foreground">Termo de consentimento</h4>

      {termoQuery.isLoading && enabled ? (
        <p className="text-sm text-muted-foreground" aria-busy="true">
          Verificando termo…
        </p>
      ) : null}

      {termo ? (
        <div className="space-y-1 rounded-md border border-border bg-muted/20 p-3">
          <p className="text-sm font-medium text-foreground">Termo assinado</p>
          <dl className="space-y-1 text-sm">
            <div className="flex gap-2">
              <dt className="text-muted-foreground">Assinado por</dt>
              <dd className="font-medium text-foreground">{termo.signerName}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-muted-foreground">Data</dt>
              <dd className="font-medium tabular-nums text-foreground">
                {formatDateInTenantTz(termo.signedAt, timeZone)}
              </dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-muted-foreground">Código de verificação</dt>
              <dd className="font-mono text-xs text-foreground">{termo.hash}</dd>
            </div>
          </dl>
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">
            Termo pendente. O termo precisa ser assinado antes do envio de fotos.
          </p>
          {canWrite ? (
            <Button type="button" variant="outline" onClick={() => setDialogOpen(true)}>
              Assinar termo
            </Button>
          ) : (
            <p className="text-sm text-muted-foreground">
              Aguardando assinatura (perfil clínico).
            </p>
          )}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Termo de consentimento</DialogTitle>
            <DialogDescription>
              Leia o texto, assine no quadro ou informe o nome completo e marque o aceite.
            </DialogDescription>
          </DialogHeader>

          <div className="max-h-[30vh] overflow-y-auto rounded-md border border-border bg-muted/20 p-3 text-sm text-foreground">
            {TERMO_TEXTO.split("\n\n").map((paragrafo) => (
              <p key={paragrafo.slice(0, 24)} className="mb-2 last:mb-0">
                {paragrafo}
              </p>
            ))}
          </div>

          <div className="space-y-1">
            <Label htmlFor="quadro-assinatura">Assinatura no quadro</Label>
            <canvas
              id="quadro-assinatura"
              data-testid="quadro-assinatura"
              ref={canvasRef}
              width={480}
              height={160}
              role="img"
              aria-label="Quadro de assinatura: desenhe com o dedo ou o mouse"
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              className="h-40 w-full touch-none rounded-md border border-input bg-background text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setTracos(0);
                const canvas = canvasRef.current;
                canvas?.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
              }}
            >
              Limpar quadro
            </Button>
          </div>

          <div className="space-y-1">
            <Label htmlFor="nome-assinatura">Nome completo (vale como assinatura)</Label>
            <Input
              id="nome-assinatura"
              name="signerName"
              type="text"
              autoComplete="name"
              enterKeyHint="done"
              placeholder="Ex.: Maria Silva"
              value={nome}
              onChange={(event) => setNome(event.target.value)}
              className="text-base"
            />
          </div>

          <div className="flex items-start gap-2">
            <Checkbox
              id="aceite-lgpd"
              name="aceiteLgpd"
              checked={aceite}
              onCheckedChange={(checked) => setAceite(checked === true)}
              aria-label="Li e estou de acordo com o uso das minhas fotos e dados para o prontuário"
            />
            <Label htmlFor="aceite-lgpd" className="text-sm font-normal">
              Li e estou de acordo com o uso das minhas fotos e dados para o prontuário.
            </Label>
          </div>

          {erro ? (
            <p role="alert" className="text-sm font-medium text-destructive">
              {erro}
            </p>
          ) : null}

          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
              Voltar
            </Button>
            <Button type="button" disabled={assinar.isPending} onClick={() => void handleConfirmar()}>
              {assinar.isPending ? (
                <>
                  <Loader2 className="animate-spin" aria-hidden="true" />
                  Registrando…
                </>
              ) : (
                "Confirmar assinatura"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
