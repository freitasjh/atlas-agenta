import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { StatePanel } from "@/components/StatePanel";
import {
  useSubscriptionCharges,
  type SubscriptionCharge,
} from "@/hooks/useSubscriptionCharges";
import { formatCentsToBRL } from "@/lib/money";
import { formatDateInTenantTz } from "@/lib/datetime";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { planoMessages } from "@/app/config/plano/plano-messages";

const t = planoMessages.invoice;

function statusLabel(status: SubscriptionCharge["status"]): string {
  switch (status) {
    case "pago":
      return t.paid;
    case "pendente":
      return t.pending;
    case "expirado":
      return t.expired;
    case "cancelado":
      return t.canceled;
  }
}

function ChargeRow({ charge }: { charge: SubscriptionCharge }) {
  const { tenant } = useCurrentUser();
  const timeZone = tenant?.timezone ?? "America/Sao_Paulo";
  const when = charge.paid_at ?? charge.expires_at;
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 py-3">
      <div className="space-y-1">
        <p className="text-sm font-medium text-foreground tabular-nums">
          {formatCentsToBRL(charge.amount_cents)}
          {charge.plan ? (
            <span className="ml-2 font-normal text-muted-foreground">
              {charge.plan}
            </span>
          ) : null}
        </p>
        {when ? (
          <p className="text-xs text-muted-foreground">
            {charge.status === "pago" ? t.paidAt : t.dueIn}{" "}
            {formatDateInTenantTz(when, timeZone)}
          </p>
        ) : null}
      </div>
      <Badge
        variant={charge.status === "pago" ? "secondary" : "outline"}
      >
        {statusLabel(charge.status)}
      </Badge>
    </li>
  );
}

/**
 * Fatura atual + histórico de faturas (RF-35): a cobrança aberta mais recente
 * (âncora `#fatura-atual` para o CTA de conta bloqueada) e o histórico.
 * Montado só com entitlements válidos — fora daqui, zero request de cobrança.
 */
export function PlanChargesCard() {
  const chargesQuery = useSubscriptionCharges();

  if (chargesQuery.isLoading) {
    return (
      <div aria-busy="true" aria-label={planoMessages.page.loading}>
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  if (chargesQuery.isError) {
    return (
      <StatePanel titulo={t.errorTitle} descricao={t.errorDescription}>
        <Button
          variant="outline"
          onClick={() => void chargesQuery.refetch()}
        >
          {planoMessages.page.retry}
        </Button>
      </StatePanel>
    );
  }

  const charges = chargesQuery.data ?? [];
  const open = charges.find((c) => c.status === "pendente") ?? null;

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card id="fatura-atual" aria-label={t.title}>
        <CardHeader>
          <CardTitle className="text-base">{t.title}</CardTitle>
          <CardDescription>
            {open
              ? `${formatCentsToBRL(open.amount_cents)} · ${statusLabel(open.status)}`
              : t.emptyTitle}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {open ? (
            <ul className="divide-y divide-border">
              <ChargeRow charge={open} />
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">
              {t.emptyDescription}
            </p>
          )}
        </CardContent>
      </Card>

      <Card aria-label={t.historyTitle}>
        <CardHeader>
          <CardTitle className="text-base">{t.historyTitle}</CardTitle>
        </CardHeader>
        <CardContent>
          {charges.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {t.emptyDescription}
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {charges.slice(0, 6).map((charge) => (
                <ChargeRow key={charge.id} charge={charge} />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
