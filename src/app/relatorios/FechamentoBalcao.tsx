import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { StatePanel } from "@/components/StatePanel";

import { useFechamentoBalcao } from "@/hooks/useFechamentoBalcao";
import { formatCentsToBRL } from "@/lib/money";
import type { PaymentsMessages } from "@/app/agenda/pagamentos/payments-messages";

/**
 * Fechamento de balcão só-leitura (ADR-24): esperado/gorjetas/estornos/por
 * operador + filtro "só balcão" via `origin`. Nenhum input, nenhum botão de
 * salvar — contado persistido é backlog (`cash_closings`). O componente só lê
 * (`useFechamentoBalcao` sob RLS admin); a trava real é o RLS do ledger.
 */
export function FechamentoBalcao({
  start,
  end,
  messages,
}: {
  start: string;
  end: string;
  messages: PaymentsMessages;
}) {
  const [onlyBalcao, setOnlyBalcao] = useState(false);
  const query = useFechamentoBalcao({ from: start, to: end, onlyBalcao });
  const t = messages.financialSummary;

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-0.5">
            <CardTitle>{t.closingTitle}</CardTitle>
            <p className="text-sm text-muted-foreground">{t.closingDescription}</p>
          </div>
          <Button
            type="button"
            variant={onlyBalcao ? "default" : "outline"}
            size="sm"
            aria-pressed={onlyBalcao}
            onClick={() => setOnlyBalcao((value) => !value)}
            className="min-h-[44px]"
          >
            {t.onlyBalcao}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {query.isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : query.isError ? (
          <StatePanel titulo={t.errorTitle} descricao={t.errorDescription}>
            <Button type="button" variant="outline" onClick={() => void query.refetch()}>
              {t.retry}
            </Button>
          </StatePanel>
        ) : !query.data ? (
          <p className="text-sm text-muted-foreground">{t.closingEmpty}</p>
        ) : (
          <div className="space-y-4">
            <dl className="grid gap-4 sm:grid-cols-3">
              <div>
                <dt className="text-sm text-muted-foreground">{t.closingExpected}</dt>
                <dd className="font-display text-2xl font-semibold tabular-nums">
                  {formatCentsToBRL(query.data.expectedCents)}
                </dd>
              </div>
              <div>
                <dt className="text-sm text-muted-foreground">{t.closingTips}</dt>
                <dd className="font-display text-2xl font-semibold tabular-nums">
                  {formatCentsToBRL(query.data.tipsCents)}
                </dd>
              </div>
              <div>
                <dt className="text-sm text-muted-foreground">{t.closingVoids}</dt>
                <dd className="font-display text-2xl font-semibold tabular-nums">
                  {query.data.voidedCount} · {formatCentsToBRL(query.data.voidedCents)}
                </dd>
              </div>
            </dl>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t.closingOperator}</TableHead>
                  <TableHead className="text-right">{t.closingCount}</TableHead>
                  <TableHead className="text-right">{t.closingValue}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {query.data.byOperator.map((row, index) => (
                  <TableRow key={`${row.operatorName ?? "sem-operador"}-${index}`}>
                    <TableCell className="font-medium">
                      {row.operatorName ?? "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{row.count}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatCentsToBRL(row.amountCents)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <p className="text-sm text-muted-foreground">{t.closingReadOnly}</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
