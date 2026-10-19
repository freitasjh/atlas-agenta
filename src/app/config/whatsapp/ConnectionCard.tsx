import { useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { QrCodeDisplay } from "@/app/config/whatsapp/QrCodeDisplay";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { usePairWhatsApp } from "@/hooks/useWhatsAppInstance";
import { mapWhatsAppError } from "@/lib/whatsapp-errors";
import type { WhatsAppConnectionStatus, WhatsAppInstance } from "@/types/domain";

/**
 * Encena a máquina de estados de `whatsapp_instances` (ADR-02):
 *  - `desconectado` / sem instância → convite para conectar + CTA "Conectar WhatsApp".
 *  - `aguardando_qr` → QR + instruções numeradas + CTA "Gerar novo código".
 *  - `conectado` → resumo da instância + último acesso relativo + "Reconectar".
 *
 * As CTAs só aparecem para quem tem `canManageWhatsAppConnection` (admin) —
 * defesa em profundidade; a trava real é RLS + autorização na Edge Function. O
 * QR é estado efêmero da página (resposta de `pair`), nunca persistido. Uma
 * região `aria-live="polite"` anuncia a transição da conexão; a instrução
 * textual numerada é a alternativa não-visual ao QR; a animação de "aguardando"
 * respeita `prefers-reduced-motion`.
 */
interface ConnectionCardProps {
  instance: WhatsAppInstance | null;
  /** Se o papel atual pode parear/reconectar (admin). */
  canManage: boolean;
}

/** Formata `last_connected_at` como tempo relativo pt-BR (ex.: "há 2 minutos"). */
function formatRelativeFromNow(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const diffSeconds = Math.round((then - Date.now()) / 1000);
  const absSeconds = Math.abs(diffSeconds);
  const formatter = new Intl.RelativeTimeFormat("pt-BR", { numeric: "auto" });

  if (absSeconds < 60) return formatter.format(Math.round(diffSeconds), "second");
  const diffMinutes = Math.round(diffSeconds / 60);
  if (Math.abs(diffMinutes) < 60) return formatter.format(diffMinutes, "minute");
  const diffHours = Math.round(diffMinutes / 60);
  if (Math.abs(diffHours) < 24) return formatter.format(diffHours, "hour");
  const diffDays = Math.round(diffHours / 24);
  return formatter.format(diffDays, "day");
}

const PAIRING_STEPS = [
  "Abra o WhatsApp no celular do número que atende os clientes.",
  "Toque em Aparelhos conectados e em Conectar um aparelho.",
  "Aponte a câmera do WhatsApp para este código.",
] as const;

export function ConnectionCard({ instance, canManage }: ConnectionCardProps) {
  const pair = usePairWhatsApp();
  const [qrCodeBase64, setQrCodeBase64] = useState<string | undefined>(
    undefined,
  );

  const status: WhatsAppConnectionStatus =
    instance?.connection_status ?? "desconectado";

  async function handleConnect() {
    try {
      const response = await pair.mutateAsync();
      setQrCodeBase64(response.qr_code_base64);
    } catch (error) {
      toast.error(mapWhatsAppError(error));
    }
  }

  if (status === "aguardando_qr") {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Conectar WhatsApp</CardTitle>
          <CardDescription>
            Aponte a câmera do WhatsApp para este código.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid gap-6 md:grid-cols-2 md:items-start">
            <div className="flex flex-col items-center gap-3">
              <QrCodeDisplay
                qrCodeBase64={qrCodeBase64}
                isLoading={pair.isPending}
              />
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <span
                  className="inline-block h-2 w-2 animate-pulse rounded-full bg-status-pendente motion-reduce:animate-none"
                  aria-hidden="true"
                />
                Aguardando leitura
              </p>
            </div>
            <div>
              <h3 className="text-sm font-semibold text-foreground">
                Como conectar
              </h3>
              <ol className="mt-2 list-decimal space-y-2 pl-5 text-sm text-muted-foreground">
                {PAIRING_STEPS.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
            </div>
          </div>
          {canManage ? (
            <Button
              variant="outline"
              onClick={handleConnect}
              disabled={pair.isPending}
            >
              {pair.isPending ? (
                <>
                  <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden="true" />
                  Gerando…
                </>
              ) : (
                "Gerar novo código"
              )}
            </Button>
          ) : null}
        </CardContent>
      </Card>
    );
  }

  if (status === "conectado") {
    const relative = instance?.last_connected_at
      ? formatRelativeFromNow(instance.last_connected_at)
      : null;
    return (
      <Card>
        <CardHeader>
          <CardTitle>WhatsApp conectado</CardTitle>
          <CardDescription>
            As mensagens para seus clientes saem por este número.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {instance?.evolution_instance_name ? (
            <p className="text-sm text-foreground">
              Instância{" "}
              <span className="font-medium">
                {instance.evolution_instance_name}
              </span>
            </p>
          ) : null}
          {relative ? (
            <p className="text-sm text-muted-foreground">
              Último acesso: {relative}
            </p>
          ) : null}
          {canManage ? (
            <Button
              variant="outline"
              onClick={handleConnect}
              disabled={pair.isPending}
            >
              {pair.isPending ? (
                <>
                  <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden="true" />
                  Reconectando…
                </>
              ) : (
                "Reconectar"
              )}
            </Button>
          ) : null}
        </CardContent>
      </Card>
    );
  }

  // desconectado / sem instância
  return (
    <Card>
      <CardHeader>
        <CardTitle>Conecte seu WhatsApp</CardTitle>
        <CardDescription>
          Nenhum número conectado ainda.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {canManage ? (
          <Button onClick={handleConnect} disabled={pair.isPending}>
            {pair.isPending ? (
              <>
                <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden="true" />
                Gerando código…
              </>
            ) : (
              "Conectar WhatsApp"
            )}
          </Button>
        ) : (
          <p className="text-sm text-muted-foreground">
            Peça a um administrador para conectar o número.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
