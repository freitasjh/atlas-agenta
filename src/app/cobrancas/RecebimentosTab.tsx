import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";

import { StatePanel } from "@/components/StatePanel";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

import {
  formatMessage,
  paymentsMessages,
  type PaymentsMessages,
} from "@/app/agenda/pagamentos/payments-messages";
import { PeriodFilter, type PeriodPreset } from "@/app/relatorios/PeriodFilter";
import { usePermissions } from "@/hooks/usePermissions";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useSegmentFeatures } from "@/hooks/useSegmentFeatures";
import {
  RECEIPT_PAGE_SIZE,
  useReceipts,
  type ReceiptMethodFilter,
  type ReceiptStatusFilter,
} from "@/hooks/useReceipts";
import { PAYMENT_METHODS, type ReceivableRow } from "@/types/payments";
import { formatCentsToBRL } from "@/lib/money";
import { resolvePresetRange, todayIsoInTenantTz } from "@/lib/period-presets";
import {
  formatDateInTenantTz,
  formatTimeInTenantTz,
} from "@/lib/datetime";

const METHOD_KEYS = ["todos", ...PAYMENT_METHODS] as const;
const SITUACAO_KEYS = ["todos", "ativos", "estornados"] as const;

function parseMethod(value: string | null): ReceiptMethodFilter {
  return (METHOD_KEYS as readonly string[]).includes(value ?? "")
    ? (value as ReceiptMethodFilter)
    : "todos";
}

function parseSituacao(value: string | null): ReceiptStatusFilter {
  return (SITUACAO_KEYS as readonly string[]).includes(value ?? "")
    ? (value as ReceiptStatusFilter)
    : "todos";
}

function parsePage(value: string | null): number {
  const page = Number(value ?? "0");
  return Number.isInteger(page) && page >= 0 ? page : 0;
}

function formatReceivedAt(iso: string, timeZone: string): string {
  const parsed = Date.parse(iso);
  if (!Number.isFinite(parsed)) return iso;
  return `${formatDateInTenantTz(iso, timeZone)} ${formatTimeInTenantTz(iso, timeZone)}`;
}

/**
 * Aba Recebimentos (`CobrancasPage`, ADR-005 §3): histórico do ledger sob RLS
 * admin, com filtros próprios (período/método/situação) e paginação
 * server-side de 25. Sem totais, sem exportação, sem estorno e sem QR nesta
 * aba (estorno/QR vivem no settlement, ADR-004).
 *
 * Linha estornada permanece no histórico em estilo apagado (`RealceRow`):
 * `text-muted-foreground` + valor riscado + badge + motivo em `title`.
 */
export function RecebimentosTab({
  messages = paymentsMessages,
}: {
  messages?: PaymentsMessages;
}) {
  const { canViewFinancials } = usePermissions();
  const { payments } = useSegmentFeatures();
  const { tenant } = useCurrentUser();
  const timeZone = tenant?.timezone ?? "America/Sao_Paulo";

  const [searchParams, setSearchParams] = useSearchParams();
  const t = messages.receipts;

  const today = todayIsoInTenantTz(timeZone);
  const monthFirst = useMemo(() => {
    const [y, m] = today.split("-").map(Number);
    return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-01`;
  }, [today]);

  const from = searchParams.get("de") || monthFirst;
  const to = searchParams.get("ate") || today;
  const method = parseMethod(searchParams.get("metodo"));
  const situacao = parseSituacao(searchParams.get("situacao"));
  const page = parsePage(searchParams.get("pag"));
  const hasCustomPeriod =
    searchParams.get("de") !== null || searchParams.get("ate") !== null;
  const [preset, setPreset] = useState<PeriodPreset>(
    hasCustomPeriod ? "personalizado" : "mes",
  );

  function patchParams(patch: Record<string, string>) {
    const next = new URLSearchParams(searchParams);
    next.set("aba", "recebimentos");
    for (const [key, value] of Object.entries(patch)) {
      next.set(key, value);
    }
    setSearchParams(next, { replace: true });
  }

  const receiptsQuery = useReceipts({ from, to, method, situacao, page });

  // QA-ADR005-01: clicar no preset já ativo refaz a query. Com os mesmos
  // parâmetros o `patchParams` não muda a URL (queryKey igual, sem refetch)
  // e a lista prende no erro até clicar outro preset.
  function handlePresetChange(next: PeriodPreset) {
    if (next === "personalizado") {
      const unchanged = next === preset;
      setPreset(next);
      if (unchanged) void receiptsQuery.refetch();
      return;
    }
    const range = resolvePresetRange(next, today);
    const unchanged =
      next === preset && range.start === from && range.end === to;
    setPreset(next);
    patchParams({ de: range.start, ate: range.end, pag: "0" });
    if (unchanged) void receiptsQuery.refetch();
  }

  if (!canViewFinancials || payments !== true) return null;

  const rows = receiptsQuery.data?.rows ?? [];
  const total = receiptsQuery.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / RECEIPT_PAGE_SIZE));

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="flex flex-wrap items-end gap-3 pt-6">
          <PeriodFilter            idPrefix="recebimentos"
            preset={preset}
            start={from}
            end={to}
            onPresetChange={handlePresetChange}
            onStartChange={(value) => {
              setPreset("personalizado");
              patchParams({ de: value, pag: "0" });
            }}
            onEndChange={(value) => {
              setPreset("personalizado");
              patchParams({ ate: value, pag: "0" });
            }}
          />
          <div className="space-y-1">
            <Label htmlFor="recebimentos-metodo">{t.filters.method}</Label>
            <Select
              value={method}
              onValueChange={(value) =>
                patchParams({ metodo: value, pag: "0" })
              }
            >
              <SelectTrigger id="recebimentos-metodo" className="w-[200px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">{t.filters.all}</SelectItem>
                {PAYMENT_METHODS.map((key) => (
                  <SelectItem key={key} value={key}>
                    {messages.method[key]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="recebimentos-situacao">{t.filters.situation}</Label>
            <Select
              value={situacao}
              onValueChange={(value) =>
                patchParams({ situacao: value, pag: "0" })
              }
            >
              <SelectTrigger id="recebimentos-situacao" className="w-[160px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SITUACAO_KEYS.map((key) => (
                  <SelectItem key={key} value={key}>
                    {t.situacao[key]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {receiptsQuery.isLoading ? (
        <div className="space-y-2" aria-busy="true">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      ) : receiptsQuery.isError ? (
        <StatePanel titulo={t.errorTitle} descricao={t.errorDescription}>
          <Button
            type="button"
            variant="outline"
            onClick={() => void receiptsQuery.refetch()}
          >
            {t.retry}
          </Button>
        </StatePanel>
      ) : rows.length === 0 ? (
        <StatePanel titulo={t.emptyTitle} descricao={t.emptyDescription} />
      ) : (
        <div aria-live="polite">
          <div className="hidden sm:block">
            <Card>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t.table.receivedAt}</TableHead>
                    <TableHead>{t.table.customer}</TableHead>
                    <TableHead>{t.table.method}</TableHead>
                    <TableHead className="text-right">{t.table.value}</TableHead>
                    <TableHead className="text-right">{t.table.tip}</TableHead>
                    <TableHead>{t.table.operator}</TableHead>
                    <TableHead>{t.table.status}</TableHead>
                    <TableHead>{t.table.link}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => (
                    <ReceiptRow
                      key={row.id}
                      row={row}
                      timeZone={timeZone}
                      messages={messages}
                    />
                  ))}
                </TableBody>
              </Table>
            </Card>
          </div>

          <ul className="space-y-3 sm:hidden">
            {rows.map((row) => (
              <li key={row.id}>
                <Card
                  className={cn(
                    row.voided_at !== null && "text-muted-foreground",
                  )}
                >
                  <CardContent className="space-y-1 py-4">
                    <p className="font-medium">
                      {row.customer_name ?? "—"}
                    </p>
                    <p className="text-xs text-muted-foreground tabular-nums">
                      {formatReceivedAt(row.received_at, timeZone)}
                    </p>
                    <p className="text-sm tabular-nums">
                      <span className={cn(row.voided_at !== null && "line-through")}>
                        {formatCentsToBRL(row.amount_cents)}
                      </span>
                      {row.tip_cents > 0 ? (
                        <span className="text-muted-foreground">
                          {" "}
                          (+{formatCentsToBRL(row.tip_cents)})
                        </span>
                      ) : null}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {messages.method[row.method]} ·{" "}
                      {row.voided_at !== null ? t.voided : t.active}
                    </p>
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>

          <div className="mt-4 flex items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground tabular-nums">
              {formatMessage(t.pageLabel, {
                atual: page + 1,
                total: totalPages,
              })}
            </p>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-11 min-h-[44px]"
                disabled={page === 0}
                onClick={() =>
                  patchParams({ pag: String(page - 1) })
                }
              >
                {t.prevPage}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-11 min-h-[44px]"
                disabled={page + 1 >= totalPages}
                onClick={() =>
                  patchParams({ pag: String(page + 1) })
                }
              >
                {t.nextPage}
              </Button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

function ReceiptRow({
  row,
  timeZone,
  messages,
}: {
  row: ReceivableRow;
  timeZone: string;
  messages: PaymentsMessages;
}) {
  const t = messages.receipts;
  const voided = row.voided_at !== null;
  return (
    <TableRow
      className={cn(voided && "text-muted-foreground")}
      title={voided && row.void_reason ? row.void_reason : undefined}
    >
      <TableCell className="tabular-nums">
        {formatReceivedAt(row.received_at, timeZone)}
      </TableCell>
      <TableCell className="font-medium">{row.customer_name ?? "—"}</TableCell>
      <TableCell>{messages.method[row.method]}</TableCell>
      <TableCell
        className={cn("text-right tabular-nums", voided && "line-through")}
      >
        {formatCentsToBRL(row.amount_cents)}
      </TableCell>
      <TableCell className="text-right tabular-nums">
        {formatCentsToBRL(row.tip_cents)}
      </TableCell>
      <TableCell>
        {row.operator_name ?? (row.source === "asaas" ? t.originAsaas : t.originManual)}
      </TableCell>
      <TableCell>
        {voided ? (
          <Badge variant="secondary">{t.voided}</Badge>
        ) : (
          t.active
        )}
      </TableCell>
      <TableCell>{row.charge_id !== null ? <Badge variant="outline">{t.pixBadge}</Badge> : "—"}</TableCell>
    </TableRow>
  );
}
