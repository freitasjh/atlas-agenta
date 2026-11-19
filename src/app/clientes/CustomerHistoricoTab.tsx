import { useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { crmMessages } from "@/app/clientes/crm-messages";
import { useCustomerHistory } from "@/hooks/useCustomerCrm";
import { usePermissions } from "@/hooks/usePermissions";
import { formatCentsToBRL } from "@/lib/money";

const t = crmMessages.historico;

/** Tamanho de página do RPC `customer_history` (teto 100 no servidor). */
const HISTORY_PAGE_SIZE = 20;

export function CustomerHistoricoTab({ customerId }: { customerId: string }) {
  const { canViewFinancials } = usePermissions();
  const [page, setPage] = useState(1);
  useEffect(() => setPage(1), [customerId]);
  const historyQuery = useCustomerHistory(customerId, page, HISTORY_PAGE_SIZE);

  if (historyQuery.isLoading) {
    return <Skeleton className="h-40 w-full" aria-label={t.loading} />;
  }

  if (historyQuery.isError) {
    return (
      <Card role="alert">
        <CardHeader>
          <CardTitle>{t.errorTitle}</CardTitle>
          <CardDescription>{t.errorDescription}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="outline" onClick={() => void historyQuery.refetch()}>
            {t.retry}
          </Button>
        </CardContent>
      </Card>
    );
  }

  const rows = historyQuery.data ?? [];
  if (rows.length === 0 && page === 1) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t.emptyTitle}</CardTitle>
          <CardDescription>{t.emptyDescription}</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const hasMore = rows.length === HISTORY_PAGE_SIZE;

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto rounded-lg border border-border">
        <Table>
          <caption className="px-4 py-2 text-left text-sm text-muted-foreground">{t.title}</caption>
          <TableHeader>
            <TableRow>
              <TableHead scope="col">{t.colDate}</TableHead>
              <TableHead scope="col">{t.colService}</TableHead>
              <TableHead scope="col">{t.colProfessional}</TableHead>
              <TableHead scope="col">{t.colStatus}</TableHead>
              {canViewFinancials ? <TableHead scope="col">{t.colValue}</TableHead> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell className="tabular-nums">
                  {new Date(row.startsAt).toLocaleDateString("pt-BR")}
                </TableCell>
                <TableCell className="font-medium text-foreground">{row.serviceName}</TableCell>
                <TableCell>{row.professionalName}</TableCell>
                <TableCell>
                  <Badge variant="outline">{row.status}</Badge>
                </TableCell>
                {canViewFinancials ? (
                  <TableCell className="font-medium tabular-nums text-foreground">
                    {row.priceCents !== null ? formatCentsToBRL(row.priceCents) : "—"}
                  </TableCell>
                ) : null}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <div className="flex items-center justify-between gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={page <= 1 || historyQuery.isFetching}
          onClick={() => setPage((current) => Math.max(1, current - 1))}
        >
          {t.prevPage}
        </Button>
        <span className="text-sm tabular-nums text-muted-foreground" aria-live="polite">
          {t.pageLabel.replace("{page}", String(page))}
        </span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!hasMore || historyQuery.isFetching}
          onClick={() => setPage((current) => current + 1)}
        >
          {t.nextPage}
        </Button>
      </div>
    </div>
  );
}
