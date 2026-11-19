import { useState } from "react";
import { Copy, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { formatCentsToBRL } from "@/lib/money";
import type { DepositCharge } from "@/lib/validations/deposit";
import { usePermissions } from "@/hooks/usePermissions";

export interface DepositChargePanelProps {
  charge: DepositCharge;
  /** Reenvia o QR (ex.: reemite/dispara WhatsApp). Pai executa o request. */
  onResendQr: () => Promise<void> | void;
  /** Cancela a cobrança + atendimento. Pai executa o request. */
  onCancel: () => Promise<void> | void;
}

/**
 * Painel da charge no drawer do agendamento (Fase 4, ADR-12 / PRD RF-06).
 * Ações respeitam RBAC: reenviar QR exige `canSendWhatsAppMessage`; cancelar
 * exige `canCancelCharge`. Sem permissão, o botão some (nunca desabilitado
 * sem explicação — a trava real é o RLS).
 */
export function DepositChargePanel({
  charge,
  onResendQr,
  onCancel,
}: DepositChargePanelProps) {
  const { canSendWhatsAppMessage, canCancelCharge } = usePermissions();
  const [busy, setBusy] = useState<"resend" | "cancel" | null>(null);
  const [copied, setCopied] = useState(false);

  async function run(action: "resend" | "cancel") {
    setBusy(action);
    try {
      if (action === "resend") await onResendQr();
      else await onCancel();
    } finally {
      setBusy(null);
    }
  }

  async function handleCopy() {
    if (!charge.pixCopiaECola) return;
    try {
      await navigator.clipboard.writeText(charge.pixCopiaECola);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <section
      aria-label="Depósito do agendamento"
      className="space-y-3 rounded-md border border-border bg-muted/30 p-3"
    >
      <div className="flex items-center justify-between gap-2 text-sm">
        <span className="font-medium">Depósito/sinal</span>
        <span className="font-display font-semibold tabular-nums text-foreground">
          {formatCentsToBRL(charge.amountCents)}
        </span>
      </div>
      <div className="flex items-center justify-between gap-2 text-sm">
        <span className="text-muted-foreground">Cobrança</span>
        <span className="font-medium" aria-label={`Estado da cobrança: ${charge.status}`}>
          {charge.status}
        </span>
      </div>

      {charge.pixCopiaECola ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void handleCopy()}
          className="w-full"
          aria-live="polite"
        >
          <Copy className="mr-2 h-4 w-4" aria-hidden="true" />
          {copied ? "Código copiado!" : "Copiar código PIX"}
        </Button>
      ) : null}

      {(canSendWhatsAppMessage || canCancelCharge) && (
        <>
          <Separator />
          <div className="flex flex-col gap-2">
            {canSendWhatsAppMessage ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={busy !== null}
                onClick={() => void run("resend")}
              >
                {busy === "resend" && (
                  <Loader2
                    className="mr-2 h-4 w-4 animate-spin motion-reduce:animate-none"
                    aria-hidden="true"
                  />
                )}
                {busy === "resend" ? "Reenviando…" : "Reenviar QR"}
              </Button>
            ) : null}
            {canCancelCharge ? (
              <Button
                type="button"
                variant="destructive"
                size="sm"
                disabled={busy !== null}
                onClick={() => void run("cancel")}
              >
                {busy === "cancel" && (
                  <Loader2
                    className="mr-2 h-4 w-4 animate-spin motion-reduce:animate-none"
                    aria-hidden="true"
                  />
                )}
                {busy === "cancel" ? "Cancelando…" : "Cancelar cobrança"}
              </Button>
            ) : null}
          </div>
        </>
      )}
    </section>
  );
}
