import { useMemo } from "react";

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
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useFinancialSummary } from "@/hooks/useFinancialSummary";
import { useReceivableLedger } from "@/hooks/useReceivables";
import { tenantRangeUtc } from "@/lib/datetime";
import { formatCentsToBRL } from "@/lib/money";
import { resolvePresetRange, todayIsoInTenantTz } from "@/lib/period-presets";

const METODO_LABEL: Record<string, string> = {
  dinheiro: "Dinheiro",
  cartao_credito: "Crédito",
  cartao_debito: "Débito",
  pix_sistema: "PIX",
  pix_maquininha: "PIX maquininha",
};

function formatarDataHora(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Aba Atendimentos (ADR-07 RF-18): ledger `appointment_payments` **somente
 * leitura** — nenhum botão de escrita, porque a receita de serviço é SSoT do
 * ledger. Números batem com `financial_summary` (mesma fonte/RPC).
 *
 * Janela: mês corrente no fuso do tenant (mesma borda semiaberta do painel
 * financeiro). A lista vem de `receivable_ledger_list` (security invoker: a RLS
 * admin do ledger vale integralmente).
 */
export function AtendimentosTab() {
  const { tenant } = useCurrentUser();
  const timeZone = tenant?.timezone ?? "America/Sao_Paulo";

  const today = todayIsoInTenantTz(timeZone);
  const range = useMemo(() => resolvePresetRange("mes", today), [today]);
  const utc = useMemo(() => tenantRangeUtc(range.start, range.end, timeZone), [range, timeZone]);

  const summary = useFinancialSummary({ startDate: range.start, endDate: range.end });
  const ledger = useReceivableLedger(
    utc?.startUtc.toISOString() ?? null,
    utc?.endUtc.toISOString() ?? null,
    true,
  );

  const carregando = summary.isPending || ledger.isPending;
  const erro = summary.isError || ledger.isError;
  const linhas = ledger.data ?? [];

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2" aria-label="Resumo do ledger de atendimentos">
        <Card>
          <CardHeader>
            <CardTitle>Recebido no mês</CardTitle>
          </CardHeader>
          <CardContent>
            {summary.isPending ? (
              <Skeleton className="h-8 w-32" />
            ) : (
              <>
                <p className="font-display text-2xl font-semibold tabular-nums tracking-tight">
                  {formatCentsToBRL(summary.data?.received_total_cents ?? 0)}
                </p>
                <p className="text-sm text-muted-foreground">
                  Serviço {formatCentsToBRL(summary.data?.received_service_cents ?? 0)} · Gorjeta{" "}
                  {formatCentsToBRL(summary.data?.received_tips_cents ?? 0)}
                </p>
              </>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Em aberto</CardTitle>
          </CardHeader>
          <CardContent>
            {summary.isPending ? (
              <Skeleton className="h-8 w-32" />
            ) : (
              <>
                <p className="font-display text-2xl font-semibold tabular-nums tracking-tight">
                  {formatCentsToBRL(summary.data?.open_cents ?? 0)}
                </p>
                <p className="text-sm text-muted-foreground">
                  A receber (PIX pendente): {formatCentsToBRL(summary.data?.receivable_cents ?? 0)}
                </p>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      <p className="text-sm text-muted-foreground">
        Fonte única de receita de atendimento. Esta aba é somente leitura: baixas e
        estornos acontecem no fluxo do atendimento.
      </p>

      {carregando ? (
        <div className="space-y-2" aria-label="Carregando recebimentos de atendimentos">
          <Skeleton className="h-11 w-full" />
          <Skeleton className="h-11 w-full" />
          <Skeleton className="h-11 w-full" />
        </div>
      ) : erro ? (
        <StatePanel
          titulo="Não foi possível carregar os recebimentos"
          descricao="Tente novamente. O ledger não foi alterado."
        >
          <Button
            type="button"
            variant="outline"
            className="min-h-11"
            onClick={() => {
              void summary.refetch();
              void ledger.refetch();
            }}
          >
            Tentar novamente
          </Button>
        </StatePanel>
      ) : linhas.length === 0 ? (
        <StatePanel
          titulo="Nenhum recebimento neste mês"
          descricao="Os recebimentos registrados no atendimento aparecem aqui, sem ação de escrita."
        />
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead scope="col">Recebido em</TableHead>
                <TableHead scope="col">Cliente</TableHead>
                <TableHead scope="col">Serviço</TableHead>
                <TableHead scope="col">Forma</TableHead>
                <TableHead scope="col" className="text-right">Valor</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {linhas.map((linha) => {
                // Total recebido na linha = serviço + gorjeta (mesma base do card
                // "Recebido no mês"). A gorjeta aparece separada para não confundir
                // com receita de serviço.
                const totalCents = linha.amount_cents + linha.tip_cents;
                return (
                  <TableRow key={linha.id}>
                    <TableCell className="tabular-nums">{formatarDataHora(linha.received_at)}</TableCell>
                    <TableCell className="font-medium">{linha.customer_name ?? "Cliente"}</TableCell>
                    <TableCell>{linha.service_name ?? "—"}</TableCell>
                    <TableCell>{METODO_LABEL[linha.method] ?? linha.method}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatCentsToBRL(totalCents)}
                      {linha.tip_cents > 0 ? (
                        <span className="block text-xs font-normal text-muted-foreground">
                          Serviço {formatCentsToBRL(linha.amount_cents)} · Gorjeta{" "}
                          {formatCentsToBRL(linha.tip_cents)}
                        </span>
                      ) : null}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
