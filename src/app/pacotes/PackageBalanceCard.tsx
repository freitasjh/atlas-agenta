import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { formatCentsToBRL } from "@/lib/money";
import type { PackageBalance } from "@/types/domain";

interface PackageBalanceCardProps {
  /** Linha de `get_package_balance` — servidor é SSoT, UI só lê. */
  balance: PackageBalance;
  /** Nome do serviço para contexto (opcional, sem PII de cliente). */
  serviceName?: string | null;
  /**
   * Preço do pacote em centavos (vem do crédito completo, não do saldo —
   * `get_package_balance` não devolve preço). `false`/ausente = recepção: só
   * "N restantes", sem preço (filtro na UI, RLS igual).
   */
  priceCents?: number | null;
  /** `false` = recepção: só "N restantes", sem preço. */
  canSeePrice: boolean;
  /** Vencido → nova venda (renovar = vender de novo, nunca reabrir). */
  onRenew?: () => void;
  /** Saldo zero → bloqueia e oferece o avulso. */
  onBuySingle?: () => void;
  timeZone?: string;
}

function formatExpiry(expiresAt: string, timeZone: string): string {
  const date = new Date(expiresAt);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone,
  }).format(date);
}

/**
 * Card de saldo de pacote (UX-SPEC T3): "X de Y restantes, expira em D" +
 * barra `role=progressbar` com `aria-valuenow/min/max` + texto de % (nunca só
 * cor). Vencido → badge + Renovar; zerado → bloqueia + oferece avulso.
 * Recepção (`canSeePrice=false`) vê só "N restantes", sem preço.
 */
export function PackageBalanceCard({
  balance,
  serviceName,
  priceCents,
  canSeePrice,
  onRenew,
  onBuySingle,
  timeZone = "America/Sao_Paulo",
}: PackageBalanceCardProps) {
  const percent =
    balance.total_sessions > 0
      ? Math.round((balance.remaining / balance.total_sessions) * 100)
      : 0;
  const exhausted = !balance.expired && balance.remaining <= 0;

  return (
    <Card
      role="group"
      aria-label={
        balance.expired
          ? `Pacote vencido${serviceName ? ` de ${serviceName}` : ""}`
          : exhausted
            ? `Saldo do pacote esgotado${serviceName ? ` de ${serviceName}` : ""}`
            : `Saldo do pacote${serviceName ? ` de ${serviceName}` : ""}: ${balance.remaining} de ${balance.total_sessions} restantes`
      }
    >
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-base">
            {serviceName ?? "Pacote de sessões"}
          </CardTitle>
          {balance.expired ? (
            <Badge variant="destructive">Vencido</Badge>
          ) : exhausted ? (
            <Badge variant="secondary">Esgotado</Badge>
          ) : null}
        </div>
        <CardDescription>
          {balance.expired
            ? `Venceu em ${formatExpiry(balance.expires_at, timeZone)}.`
            : exhausted
              ? "Todas as sessões foram utilizadas."
              : `${balance.remaining} de ${balance.total_sessions} restantes · expira em ${formatExpiry(balance.expires_at, timeZone)}`}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {balance.expired ? (
          <p className="text-sm text-muted-foreground">
            Pacotes vencidos não reabrem. Para continuar, faça uma nova venda.
          </p>
        ) : exhausted ? (
          <p className="text-sm text-muted-foreground">
            O saldo chegou a zero. Cobre a próxima sessão como avulso ou venda
            um novo pacote.
          </p>
        ) : (
          <div className="space-y-1">
            <div
              role="progressbar"
              aria-label="Saldo restante do pacote"
              aria-valuenow={balance.remaining}
              aria-valuemin={0}
              aria-valuemax={balance.total_sessions}
              aria-valuetext={`${percent}% restante`}
              className="h-2 w-full overflow-hidden rounded-full bg-muted"
            >
              <div
                className="h-full rounded-full bg-primary transition-[width]"
                style={{ width: `${percent}%` }}
                aria-hidden="true"
              />
            </div>
            <p className="text-xs tabular-nums text-muted-foreground">
              {percent}% restante
            </p>
          </div>
        )}
        {canSeePrice && priceCents != null && !balance.expired && !exhausted ? (
          <p className="text-sm text-muted-foreground">
            Valor do pacote:{" "}
            <span className="font-medium tabular-nums text-foreground">
              {formatCentsToBRL(priceCents)}
            </span>
          </p>
        ) : null}
        {balance.expired && onRenew ? (
          <Button type="button" onClick={onRenew}>
            Renovar (nova venda)
          </Button>
        ) : null}
        {exhausted && onBuySingle ? (
          <Button type="button" variant="outline" onClick={onBuySingle}>
            Cobrar sessão avulsa
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}
