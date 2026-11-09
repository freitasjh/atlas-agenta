import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { PageHeader } from "@/components/PageHeader";
import { StatePanel } from "@/components/StatePanel";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import { usePermissions } from "@/hooks/usePermissions";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useSegmentFeatures } from "@/hooks/useSegmentFeatures";
import { useFinancialSummary } from "@/hooks/useFinancialSummary";
import { FechamentoBalcao } from "@/app/relatorios/FechamentoBalcao";
import { formatCentsToBRL } from "@/lib/money";
import { resolvePresetRange, todayIsoInTenantTz } from "@/lib/period-presets";
import {
  paymentsMessages,
  type PaymentsMessages,
} from "@/app/agenda/pagamentos/payments-messages";
import {
  PeriodFilter,
  type PeriodPreset,
} from "@/app/relatorios/PeriodFilter";
import { PAYMENT_METHODS } from "@/types/payments";

/** `YYYY-MM-DD` → `dd/MM/yyyy` por aritmética de calendário (sem fuso). */
function formatShortDate(dateStr: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (!match) return dateStr;
  const [, year, month, day] = match;
  return `${day}/${month}/${year}`;
}

/**
 * Painel financeiro admin (`/app/relatorios/financeiro`, ADR-005 §4).
 * Receita SÓ do ledger (via `useFinancialSummary`); `charges.pago` nunca é
 * lido aqui. Sem gráfico, sem quinto card: 2 grupos (Recebido/Pendências),
 * total como linha, tabela por-método com as 5 formas, nota caixa ×
 * competência.
 *
 * Gating em camadas, sem flash e sem request indevido: fora de salão/
 * barbearia → estado de ramo; sem `canViewFinancials` → neutro. O hook só
 * dispara quando segmento + RBAC permitem.
 */
export function FinanceiroPage({
  messages = paymentsMessages,
}: {
  messages?: PaymentsMessages;
}) {
  const { tenant } = useCurrentUser();
  const timeZone = tenant?.timezone ?? "America/Sao_Paulo";

  const { payments } = useSegmentFeatures();
  const { canViewFinancials } = usePermissions();

  const [preset, setPreset] = useState<PeriodPreset>("mes");
  const today = todayIsoInTenantTz(timeZone);
  const initialRange = useMemo(() => resolvePresetRange("mes", today), [today]);
  const [start, setStart] = useState(initialRange.start);
  const [end, setEnd] = useState(initialRange.end);

  useEffect(() => {
    if (preset === "personalizado") return;
    const range = resolvePresetRange(preset, today);
    setStart(range.start);
    setEnd(range.end);
  }, [preset, today]);

  const summaryQuery = useFinancialSummary({ startDate: start, endDate: end });
  const t = messages.financialSummary;

  // QA-ADR005-01: clicar no preset já ativo refaz a query. Sem isso, com
  // start/end inalterados o `useEffect` acima não roda e o painel prende no
  // erro até clicar outro preset. Quando o intervalo não muda, força refetch.
  function handlePresetChange(next: PeriodPreset) {
    if (next === "personalizado") {
      const unchanged = next === preset;
      setPreset(next);
      if (unchanged) void summaryQuery.refetch();
      return;
    }
    const range = resolvePresetRange(next, today);
    const unchanged =
      next === preset && range.start === start && range.end === end;
    setStart(range.start);
    setEnd(range.end);
    setPreset(next);
    if (unchanged) void summaryQuery.refetch();
  }

  if (!payments) {
    return (
      <div className="space-y-6">
        <PageHeader titulo={t.title} descricao={t.description} />
        <StatePanel titulo={t.segmentOnlyTitle} descricao={t.segmentOnlyDescription} />
      </div>
    );
  }

  if (!canViewFinancials) {
    return (
      <div className="space-y-6">
        <PageHeader titulo={t.title} descricao={t.description} />
        <StatePanel titulo={t.noAccessTitle} descricao={t.noAccessDescription} />
      </div>
    );
  }

  const summary = summaryQuery.data;
  const periodLabel = `${formatShortDate(start)} – ${formatShortDate(end)}`;

  const cards = summary
    ? [
        {
          key: "service",
          label: t.cardService,
          value: summary.received_service_cents,
          ariaLabel: `${t.cardService}: ${formatCentsToBRL(summary.received_service_cents)} no período ${periodLabel}`,
        },
        {
          key: "tips",
          label: t.cardTips,
          value: summary.received_tips_cents,
          ariaLabel: `${t.cardTips}: ${formatCentsToBRL(summary.received_tips_cents)} no período ${periodLabel}`,
        },
        {
          key: "receivable",
          label: t.cardReceivable,
          value: summary.receivable_cents,
          ariaLabel: `${t.cardReceivable}: ${formatCentsToBRL(summary.receivable_cents)}`,
        },
        {
          key: "open",
          label: t.cardOpen,
          value: summary.open_cents,
          ariaLabel: `${t.cardOpen}: ${formatCentsToBRL(summary.open_cents)} no período ${periodLabel}`,
        },
      ]
    : [];

  return (
    <div className="space-y-6">
      <PageHeader titulo={t.title} descricao={t.description} />

      <PeriodFilter
        idPrefix="financeiro"
        preset={preset}
        start={start}
        end={end}
        onPresetChange={handlePresetChange}
        onStartChange={setStart}
        onEndChange={setEnd}
      />

      {summaryQuery.isLoading ? (
        <div className="space-y-2" aria-busy="true">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-48 w-full" />
        </div>
      ) : summaryQuery.isError ? (
        <StatePanel titulo={t.errorTitle} descricao={t.errorDescription}>
          <Button
            type="button"
            variant="outline"
            onClick={() => void summaryQuery.refetch()}
          >
            {t.retry}
          </Button>
        </StatePanel>
      ) : !summary ? (
        <StatePanel titulo={t.emptyTitle} descricao={t.emptyDescription} />
      ) : (
        <>
          <section aria-label={t.groupReceived} className="space-y-3">
            <div className="space-y-0.5">
              <h2 className="font-display text-lg font-semibold tracking-tight">
                {t.groupReceived}
              </h2>
              <p className="text-sm text-muted-foreground">{t.groupReceivedBase}</p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              {cards.slice(0, 2).map((card) => (
                <Card key={card.key}>
                  <CardContent className="space-y-1 py-4">
                    <div
                      role="group"
                      aria-label={card.ariaLabel}
                      data-testid={`finance-card-${card.key}`}
                    >
                      <p className="text-sm text-muted-foreground">{card.label}</p>
                      <p className="font-display text-2xl font-semibold tabular-nums">
                        {formatCentsToBRL(card.value)}
                      </p>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
            <p className="text-sm text-muted-foreground tabular-nums" data-testid="finance-total-line">
              {t.totalLine}:{" "}
              <span className="font-medium text-foreground">
                {formatCentsToBRL(summary.received_total_cents)}
              </span>
            </p>
          </section>

          <section aria-label={t.groupPending} className="space-y-3">
            <div className="space-y-0.5">
              <h2 className="font-display text-lg font-semibold tracking-tight">
                {t.groupPending}
              </h2>
              <p className="text-sm text-muted-foreground">{t.groupPendingBase}</p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              {cards.slice(2).map((card) => (
                <Card key={card.key}>
                  <CardContent className="space-y-1 py-4">
                    <div
                      role="group"
                      aria-label={card.ariaLabel}
                      data-testid={`finance-card-${card.key}`}
                    >
                      <p className="text-sm text-muted-foreground">{card.label}</p>
                      <p className="font-display text-2xl font-semibold tabular-nums">
                        {formatCentsToBRL(card.value)}
                      </p>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </section>

          <p className="text-sm text-muted-foreground">
            {t.cashNote}{" "}
            <Link
              to="/app/relatorios/comissoes"
              className="underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {t.commissionsLink}
            </Link>
          </p>

          <Card>
            <CardHeader>
              <CardTitle>{t.byMethodTitle}</CardTitle>
            </CardHeader>            <CardContent>
              {summary.received_service_cents === 0 &&
              summary.received_tips_cents === 0 ? (
                <p className="text-sm text-muted-foreground">{t.emptyTitle}</p>
              ) : null}
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{messages.receipts.table.method}</TableHead>
                    <TableHead className="text-right">
                      {messages.receipts.table.value}
                    </TableHead>
                    <TableHead className="text-right">
                      {messages.receipts.table.tip}
                    </TableHead>
                    <TableHead className="text-right">
                      {t.byMethodCountHeader}
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {PAYMENT_METHODS.map((method) => {
                    const row = summary.by_method.find((r) => r.method === method);
                    return (
                      <TableRow key={method}>
                        <TableCell className="font-medium">
                          {messages.method[method]}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatCentsToBRL(row?.amount_cents ?? 0)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatCentsToBRL(row?.tip_cents ?? 0)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {row?.count ?? 0}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <FechamentoBalcao start={start} end={end} messages={messages} />
        </>
      )}
    </div>
  );
}
