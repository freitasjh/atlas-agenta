import { useState } from "react";
import { Plus } from "lucide-react";

import { PageHeader } from "@/components/PageHeader";
import { StatePanel } from "@/components/StatePanel";
import { EntitlementGate } from "@/components/EntitlementGate";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { SellPackageDialog } from "@/app/config/pacotes/SellPackageDialog";
import { usePackageCredits } from "@/hooks/usePackageCredits";
import { usePlanEntitlements } from "@/hooks/usePlanEntitlements";
import { formatCentsToBRL } from "@/lib/money";

function formatExpiryShort(expiresAt: string): string {
  const date = new Date(expiresAt);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "America/Sao_Paulo",
  }).format(date);
}

function CreditStatusBadge({ status }: { status: string }) {
  if (status === "exhausted") return <Badge variant="secondary">Esgotado</Badge>;
  return <Badge variant="default">Ativo</Badge>;
}

/**
 * Config → Pacotes (`/app/config/pacotes`, admin-only, espelho `CombosPage`):
 * tabela real de vendas de pacote com `<caption>` + `th scope`, Dialog "Novo
 * pacote" (venda). Gating por entitlement `pacotes` (ADR-01): sem entitlement
 * o conteúdo segue legível + empty com upsell, sem disparar venda.
 *
 * A tabela mostra linhas vencidas com badge (vencido = venda nova resolve);
 * zeradas bloqueiam na baixa com avulso (card/dialogo de venda).
 */
export function PacotesPage() {
  const entitlements = usePlanEntitlements();
  const pacotesEntitled = entitlements?.pacotes === true;
  const creditsQuery = usePackageCredits({ enabled: pacotesEntitled });
  const [sellOpen, setSellOpen] = useState(false);

  const credits = creditsQuery.data ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        titulo="Pacotes"
        descricao="Vendas de pacotes de sessões: saldo, validade e baixa automática ao concluir."
        acoes={
          pacotesEntitled ? (
            <Button onClick={() => setSellOpen(true)}>
              <Plus aria-hidden="true" />
              Novo pacote
            </Button>
          ) : undefined
        }
      />

      <EntitlementGate
        entitled={entitlements?.pacotes ?? null}
        recurso="Pacotes"
        acaoLabel="Novo pacote"
      >
        {creditsQuery.isLoading ? (
          <div className="space-y-2" aria-busy="true">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : creditsQuery.isError ? (
          <StatePanel
            titulo="Não foi possível carregar os pacotes"
            descricao="Verifique sua conexão e tente novamente."
          >
            <Button variant="outline" onClick={() => void creditsQuery.refetch()}>
              Tentar novamente
            </Button>
          </StatePanel>
        ) : credits.length === 0 ? (
          <StatePanel
            titulo="Nenhum pacote vendido"
            descricao="Venda o primeiro pacote para acompanhar saldo e validade aqui."
          >
            {pacotesEntitled ? (
              <Button onClick={() => setSellOpen(true)}>
                <Plus aria-hidden="true" />
                Novo pacote
              </Button>
            ) : null}
          </StatePanel>
        ) : (
          <div className="rounded-lg border border-border">
            <Table>
              <caption className="px-4 py-2 text-left text-sm text-muted-foreground">
                Pacotes vendidos: cliente, serviço, sessões utilizadas, preço e
                validade. A baixa é automática ao concluir o atendimento.
              </caption>
              <TableHeader>
                <TableRow>
                  <TableHead scope="col">Cliente</TableHead>
                  <TableHead scope="col">Serviço</TableHead>
                  <TableHead scope="col">Sessões</TableHead>
                  <TableHead scope="col">Preço</TableHead>
                  <TableHead scope="col">Expira em</TableHead>
                  <TableHead scope="col">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {credits.map((credit) => {
                  const expired = new Date(credit.expires_at).getTime() <= Date.now();
                  const percent =
                    credit.total_sessions > 0
                      ? Math.round(
                          ((credit.total_sessions - credit.used_sessions) /
                            credit.total_sessions) *
                            100,
                        )
                      : 0;
                  return (
                    <TableRow key={credit.id}>
                      <TableCell className="font-medium text-foreground">
                        {credit.customerName ?? "—"}
                      </TableCell>
                      <TableCell>{credit.serviceName ?? "—"}</TableCell>
                      <TableCell>
                        <span className="tabular-nums">
                          {credit.used_sessions}/{credit.total_sessions}
                        </span>{" "}
                        <span className="text-xs tabular-nums text-muted-foreground">
                          ({percent}% restante)
                        </span>
                      </TableCell>
                      <TableCell className="tabular-nums">
                        {formatCentsToBRL(credit.price_cents)}
                      </TableCell>
                      <TableCell className="tabular-nums">
                        {formatExpiryShort(credit.expires_at)}
                      </TableCell>
                      <TableCell>
                        {expired ? (
                          <Badge variant="destructive">Vencido</Badge>
                        ) : (
                          <CreditStatusBadge status={credit.status} />
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </EntitlementGate>

      {pacotesEntitled ? (
        <SellPackageDialog open={sellOpen} onOpenChange={setSellOpen} />
      ) : null}
    </div>
  );
}
