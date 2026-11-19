import { useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { crmMessages } from "@/app/clientes/crm-messages";
import { useCustomerSummary, useUpdateCustomerConsent } from "@/hooks/useCustomerCrm";
import { usePermissions } from "@/hooks/usePermissions";
import { formatCentsToBRL } from "@/lib/money";
import type { Customer } from "@/types/domain";

const t = crmMessages.resumo;

function formatDateTime(iso: string | null): string {
  if (!iso) return t.never;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return t.never;
  return d.toLocaleString("pt-BR");
}

export function CustomerResumoTab({ customer }: { customer: Customer }) {
  const { canViewFinancials, canManageCustomers } = usePermissions();
  const summaryQuery = useCustomerSummary(customer.id, customer.whatsapp_opt_in);
  const consentMutation = useUpdateCustomerConsent(customer.id);
  const [pendingOptIn, setPendingOptIn] = useState<boolean | null>(null);

  if (summaryQuery.isLoading) {
    return <Skeleton className="h-40 w-full" aria-label={t.loading} />;
  }

  if (summaryQuery.isError || !summaryQuery.data) {
    return (
      <Card role="alert">
        <CardHeader>
          <CardTitle>{t.errorTitle}</CardTitle>
          <CardDescription>{t.errorDescription}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="outline" onClick={() => void summaryQuery.refetch()}>
            {t.retry}
          </Button>
        </CardContent>
      </Card>
    );
  }

  const summary = summaryQuery.data;
  const optIn = pendingOptIn ?? summary.whatsappOptIn;

  async function handleConsentChange(next: boolean) {
    setPendingOptIn(next);
    try {
      await consentMutation.mutateAsync({ whatsappOptIn: next });
      toast.success(t.consentUpdated);
    } catch {
      setPendingOptIn(null);
      toast.error(t.consentError);
    }
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3" role="group" aria-label={t.title}>
        <div className="rounded-lg border border-border p-4">
          <p className="text-sm font-medium text-muted-foreground">{t.noShow}</p>
          <p className="font-display text-3xl font-semibold tabular-nums tracking-tight text-foreground">
            {summary.noShowCount}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {t.noShowHint
              .replace("{count}", String(summary.noShowCount))
              .replace("{total}", String(summary.totalCount))}
          </p>
        </div>
        <div className="rounded-lg border border-border p-4">
          <p className="text-sm font-medium text-muted-foreground">{t.lastVisit}</p>
          <p className="mt-1 text-sm font-semibold tabular-nums text-foreground">
            {summary.lastVisitAt
              ? new Date(summary.lastVisitAt).toLocaleDateString("pt-BR")
              : t.neverVisited}
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t.avgTicket}</CardTitle>
        </CardHeader>
        <CardContent>
          {canViewFinancials ? (
            <p className="font-display text-2xl font-semibold tabular-nums tracking-tight text-foreground">
              {summary.avgTicketCents !== null ? formatCentsToBRL(summary.avgTicketCents) : t.never}
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">{t.avgTicketHidden}</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t.tags}</CardTitle>
        </CardHeader>
        <CardContent>
          {summary.tags.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t.noTags}</p>
          ) : (
            <ul className="flex flex-wrap gap-2" aria-label={t.tags}>
              {summary.tags.map((tag) => (
                <li key={tag}>
                  <Badge variant="secondary">{tag}</Badge>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-sm text-muted-foreground">
            {t.segment}:{" "}
            <span className="font-medium text-foreground">{summary.segment ?? t.noSegment}</span>
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t.consent}</CardTitle>
          <CardDescription>
            {summary.lgpdConsentVersion
              ? t.consentVersion.replace("{version}", summary.lgpdConsentVersion)
              : t.never}
            {" · "}
            {formatDateTime(summary.lgpdConsentAt)}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-foreground">{t.optIn}</p>
              <p className="text-xs text-muted-foreground">
                {t.optInAt}: {formatDateTime(summary.whatsappOptInAt)}
              </p>
            </div>
            {canManageCustomers ? (
              <Switch
                checked={optIn}
                onCheckedChange={(next) => void handleConsentChange(next)}
                disabled={consentMutation.isPending}
                aria-label={t.updateConsent}
              />
            ) : (
              <Badge variant={optIn ? "secondary" : "outline"}>
                {optIn ? t.optInYes : t.optInNo}
              </Badge>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
