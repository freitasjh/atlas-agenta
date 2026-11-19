import { useState } from "react";
import { CheckCircle, Copy, Loader2, QrCode } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { formatCentsToBRL } from "@/lib/money";
import type { DepositCharge } from "@/lib/validations/deposit";

export type DepositStepStatus = "idle" | "loading" | "ready" | "error";

export interface DepositStepProps {
  serviceName: string;
  amountCents: number;
  deadlineHours: number;
  refundHint: string;
  status: DepositStepStatus;
  charge?: DepositCharge | null;
  errorMessage?: string | null;
  onRetry?: () => void;
}

/**
 * Passo "Depósito" do agendamento público (Fase 4, ADR-12 / PRD RF-02).
 * Apresentação pura: valor, PIX (QR + copia-e-cola), prazo e aviso de
 * reembolso. Estados loading/success/error obrigatórios; sem requests aqui —
 * o pai carrega a charge e entrega via props.
 */
export function DepositStep({
  serviceName,
  amountCents,
  deadlineHours,
  refundHint,
  status,
  charge,
  errorMessage,
  onRetry,
}: DepositStepProps) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    const text = charge?.pixCopiaECola ?? "";
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <Card aria-busy={status === "loading"}>
      <CardHeader>
        <CardTitle className="font-display">Depósito para confirmar</CardTitle>
        <CardDescription>
          {serviceName} — pague o sinal via PIX em até {deadlineHours}{" "}
          {deadlineHours === 1 ? "hora" : "horas"}.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Valor do sinal:{" "}
          <span className="font-display text-2xl font-semibold tabular-nums tracking-tight text-foreground">
            {formatCentsToBRL(amountCents)}
          </span>
        </p>

        {status === "loading" ? (
          <div
            role="status"
            aria-label="Gerando cobrança PIX"
            className="flex items-center gap-2 text-sm text-muted-foreground"
          >
            <Loader2
              className="h-4 w-4 animate-spin motion-reduce:animate-none"
              aria-hidden="true"
            />
            Gerando cobrança PIX…
          </div>
        ) : null}

        {status === "error" ? (
          <div role="alert" className="space-y-3">
            <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {errorMessage ?? "Não foi possível gerar a cobrança. Tente de novo."}
            </p>
            {onRetry ? (
              <Button
                type="button"
                variant="outline"
                onClick={onRetry}
                className="min-h-11"
              >
                Tentar novamente
              </Button>
            ) : null}
          </div>
        ) : null}

        {status === "ready" && charge ? (
          <div className="space-y-4">
            <div
              role="status"
              aria-label="Aguardando depósito"
              className="rounded-md border border-border bg-muted/30 px-3 py-2 text-sm font-medium"
            >
              Aguardando depósito — o horário fica reservado até o pagamento.
            </div>
            <div className="flex flex-col items-center gap-3">
              {charge.pixQrCode ? (
                // QR como data-URL vinda da Edge Function; alt descritivo.
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={charge.pixQrCode}
                  alt="QR Code PIX do depósito"
                  className="h-48 w-48 rounded-md border border-border bg-white p-2"
                />
              ) : (
                <div
                  role="img"
                  aria-label="QR Code PIX do depósito indisponível, use o copia e cola"
                  className="flex h-48 w-48 flex-col items-center justify-center gap-2 rounded-md border border-dashed border-border text-muted-foreground"
                >
                  <QrCode className="h-8 w-8" aria-hidden="true" />
                  <span className="px-4 text-center text-xs">
                    QR indisponível — use o copia e cola abaixo
                  </span>
                </div>
              )}
              {charge.pixCopiaECola ? (
                <div className="w-full space-y-2">
                  <p className="text-xs font-medium text-muted-foreground uppercase">
                    PIX copia e cola
                  </p>
                  <p className="break-all rounded-md bg-muted/50 p-3 font-mono text-xs">
                    {charge.pixCopiaECola}
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => void handleCopy()}
                    className="w-full min-h-11"
                    aria-live="polite"
                  >
                    {copied ? (
                      <>
                        <CheckCircle
                          className="mr-2 h-4 w-4 text-status-concluido"
                          aria-hidden="true"
                        />
                        Código copiado!
                      </>
                    ) : (
                      <>
                        <Copy className="mr-2 h-4 w-4" aria-hidden="true" />
                        Copiar código PIX
                      </>
                    )}
                  </Button>
                </div>
              ) : null}
            </div>
          </div>
        ) : null}

        <p className="text-xs text-muted-foreground">{refundHint}</p>
      </CardContent>
    </Card>
  );
}
