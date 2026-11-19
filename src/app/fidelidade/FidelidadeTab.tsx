import { useMemo } from "react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { usePlanEntitlements } from "@/hooks/usePlanEntitlements";
import { useLoyaltyAccounts, useLoyaltyTransactions } from "@/hooks/useFidelidade";
import { loyaltyLevelFor, transactionTypeLabel } from "@/app/fidelidade/model";
import { fidelidadeMessages } from "@/app/fidelidade/fidelidade-messages";
import { useLoyaltyProgram } from "@/hooks/useFidelidade";

const t = fidelidadeMessages.card;

/**
 * Aba Fidelidade do CRM (ADR-15 RF-18, UX-SPEC D/E).
 *
 * Exibe saldo + nível + extrato do cliente. Componente reutilizável para a
 * ficha 360° da ADR-16 — não dispara request sensível sem entitlement
 * `fidelidade` (queries com `enabled`).
 */
export function FidelidadeTab({ customerId }: { customerId: string }) {
  const entitlements = usePlanEntitlements();
  const entitled = entitlements?.fidelidade === true;

  const programQuery = useLoyaltyProgram({ enabled: entitled });
  const accountsQuery = useLoyaltyAccounts({ enabled: entitled });

  const account = useMemo(
    () => (accountsQuery.data ?? []).find((a) => a.customer_id === customerId) ?? null,
    [accountsQuery.data, customerId],
  );

  const txQuery = useLoyaltyTransactions(account?.id ?? null, { enabled: entitled });
  const transactions = txQuery.data ?? [];

  if (accountsQuery.isLoading) {
    return <Skeleton className="h-32 w-full" aria-label={fidelidadeMessages.page.loading} />;
  }

  if (!account) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t.title}</CardTitle>
          <CardDescription>{t.description}</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">{t.emptyDescription}</p>
        </CardContent>
      </Card>
    );
  }

  const level = loyaltyLevelFor(programQuery.data?.levels, account.balance_points);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t.title}</CardTitle>
        <CardDescription>{t.description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div
          className="grid grid-cols-2 gap-3 sm:grid-cols-3"
          role="group"
          aria-label={`${t.balanceLabel}: ${account.balance_points}`}
        >
          <div className="rounded-lg border border-border p-4">
            <p className="text-sm font-medium text-muted-foreground">{t.balanceLabel}</p>
            <p className="font-display text-3xl font-semibold tabular-nums tracking-tight text-foreground">
              {account.balance_points}
            </p>
          </div>
          <div className="rounded-lg border border-border p-4">
            <p className="text-sm font-medium text-muted-foreground">{t.lifetimeLabel}</p>
            <p className="font-display text-3xl font-semibold tabular-nums tracking-tight text-foreground">
              {account.lifetime_points}
            </p>
          </div>
          <div className="rounded-lg border border-border p-4">
            <p className="text-sm font-medium text-muted-foreground">{t.levelLabel}</p>
            <p className="text-lg font-semibold text-foreground">{level ?? t.noLevel}</p>
          </div>
        </div>

        {txQuery.isLoading ? (
          <Skeleton className="h-20 w-full" />
        ) : transactions.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t.emptyDescription}</p>
        ) : (
          <div className="rounded-lg border border-border">
            <Table>
              <caption className="px-4 py-2 text-left text-sm text-muted-foreground">
                {t.tableCaption}
              </caption>
              <TableHeader>
                <TableRow>
                  <TableHead scope="col">{t.colDate}</TableHead>
                  <TableHead scope="col">{t.colType}</TableHead>
                  <TableHead scope="col">{t.colPoints}</TableHead>
                  <TableHead scope="col">{t.colReason}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {transactions.map((tx) => (
                  <TableRow key={tx.id}>
                    <TableCell className="tabular-nums">
                      {new Date(tx.created_at).toLocaleString("pt-BR")}
                    </TableCell>
                    <TableCell>
                      <Badge variant={tx.type === "credit" ? "secondary" : "outline"}>
                        {transactionTypeLabel(tx.type)}
                      </Badge>
                    </TableCell>
                    <TableCell className="tabular-nums font-medium text-foreground">
                      {tx.points}
                    </TableCell>
                    <TableCell>{tx.reason ?? "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
