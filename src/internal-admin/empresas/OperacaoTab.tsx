import { useMemo } from "react";

import { StatePanel } from "@/components/StatePanel";
import { StatusBadge, getSubscriptionStatusLabel } from "@/components/StatusBadge";
import { Badge } from "@/components/ui/badge";
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

import { useAdminTenants } from "@/hooks/useAdminTenants";
import {
  useBackofficeStatusAudit,
  useBackofficeSubscriptions,
  type BackofficeSubscription,
  type StatusAuditEntry,
} from "@/internal-admin/backoffice/useBackoffice";
import { useBackofficeEntitlements } from "@/internal-admin/backoffice/useBackofficeEntitlements";
import { SuspenderTenantDialog } from "@/internal-admin/empresas/SuspenderTenantDialog";
import { formatCentsToBRL } from "@/lib/money";
import { formatarDateTimeOperacao } from "@/internal-admin/empresas/operacaoMeta";
import { getPlanLabel } from "@/lib/subscription-status";
import type { SubscriptionStatus, TenantListItem } from "@/types/domain";

/** Status SaaS com ação operacional no back-office. */
const STATUS_OPERAVEIS: readonly SubscriptionStatus[] = [
  "ativo",
  "pendente",
  "bloqueado",
];

function displayName(tenant: TenantListItem): string {
  const trade = tenant.trade_name?.trim();
  return trade && trade.length > 0 ? trade : tenant.legal_name;
}

const ASSINATURA_STATUS_LABEL: Record<
  BackofficeSubscription["status"],
  string
> = {
  ativa: "Ativa",
  inadimplente: "Inadimplente",
  pausada: "Pausada",
  cancelada: "Cancelada",
};

const PERIODO_LABEL: Record<BackofficeSubscription["billing_period"], string> = {
  mensal: "mensal",
  trimestral: "trimestral",
  anual: "anual",
};

/** Uma linha de assinatura está em inadimplência quando o status ou vencidas dizem isso. */
export function isInadimplente(row: BackofficeSubscription): boolean {
  return row.status === "inadimplente" || row.overdue_charges > 0;
}

/** Empresas operáveis: ativo/pendente (suspender) e bloqueado (retomar). */
export function tenantsOperaveis(
  tenants: TenantListItem[],
): TenantListItem[] {
  return tenants
    .filter((tenant) => STATUS_OPERAVEIS.includes(tenant.subscription_status))
    .sort((a, b) => {
      const rank = (t: TenantListItem) =>
        t.subscription_status === "bloqueado"
          ? 0
          : t.subscription_status === "pendente"
            ? 1
            : 2;
      return rank(a) - rank(b) || displayName(a).localeCompare(displayName(b));
    });
}

function AssinaturasTable({
  rows,
}: {
  rows: BackofficeSubscription[];
}) {
  return (
    <>
      <div className="hidden rounded-lg border border-border md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Empresa</TableHead>
              <TableHead>Cliente</TableHead>
              <TableHead>Plano</TableHead>
              <TableHead>Valor</TableHead>
              <TableHead>Próxima cobrança</TableHead>
              <TableHead>Vencidas</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => {
              const inadimplente = isInadimplente(row);
              return (
                <TableRow
                  key={row.subscription_id}
                  className={inadimplente ? "bg-destructive/5" : undefined}
                >
                  <TableCell className="font-medium">
                    {row.tenant_name}
                  </TableCell>
                  <TableCell>{row.customer_name}</TableCell>
                  <TableCell>
                    {row.plan_name}{" "}
                    <span className="text-xs text-muted-foreground">
                      ({PERIODO_LABEL[row.billing_period]})
                    </span>
                  </TableCell>
                  <TableCell className="tabular-nums">
                    {formatCentsToBRL(row.amount_cents)}
                  </TableCell>
                  <TableCell>{formatarDateTimeOperacao(row.next_charge_at)}</TableCell>
                  <TableCell className="tabular-nums">
                    {row.overdue_charges > 0 ? (
                      <span className="font-medium text-destructive">
                        {row.overdue_charges} ·{" "}
                        {formatCentsToBRL(row.overdue_amount_cents)}
                      </span>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant={inadimplente ? "destructive" : "secondary"}>
                      {ASSINATURA_STATUS_LABEL[row.status]}
                    </Badge>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <ul className="space-y-3 md:hidden">
        {rows.map((row) => {
          const inadimplente = isInadimplente(row);
          return (
            <li
              key={row.subscription_id}
              className={
                inadimplente
                  ? "rounded-lg border border-destructive/40 bg-destructive/5 p-4"
                  : "rounded-lg border border-border p-4"
              }
            >
              <div className="flex items-start justify-between gap-2">
                <p className="font-medium">{row.tenant_name}</p>
                <Badge variant={inadimplente ? "destructive" : "secondary"}>
                  {ASSINATURA_STATUS_LABEL[row.status]}
                </Badge>
              </div>
              <p className="text-sm text-muted-foreground">{row.customer_name}</p>
              <p className="mt-1 text-sm">
                {row.plan_name} · {formatCentsToBRL(row.amount_cents)} (
                {PERIODO_LABEL[row.billing_period]})
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Próxima cobrança: {formatarDateTimeOperacao(row.next_charge_at)}
              </p>
              {row.overdue_charges > 0 ? (
                <p className="mt-1 text-xs font-medium text-destructive">
                  {row.overdue_charges} vencida(s) ·{" "}
                  {formatCentsToBRL(row.overdue_amount_cents)}
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>
    </>
  );
}

function EmpresasOperaveisTable({ tenants }: { tenants: TenantListItem[] }) {
  return (
    <>
      <div className="hidden rounded-lg border border-border md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Empresa</TableHead>
              <TableHead>Plano</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {tenants.map((tenant) => (
              <TableRow key={tenant.id}>
                <TableCell className="font-medium">
                  {displayName(tenant)}
                </TableCell>
                <TableCell>{getPlanLabel(tenant.plan)}</TableCell>
                <TableCell>
                  <StatusBadge subscriptionStatus={tenant.subscription_status} />
                </TableCell>
                <TableCell>
                  <span className="inline-flex flex-wrap justify-end gap-2">
                    <SuspenderTenantDialog tenant={tenant} acao="suspender" />
                    <SuspenderTenantDialog tenant={tenant} acao="retomar" />
                  </span>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <ul className="space-y-3 md:hidden">
        {tenants.map((tenant) => (
          <li key={tenant.id} className="rounded-lg border border-border p-4">
            <p className="font-medium">{displayName(tenant)}</p>
            <p className="text-sm text-muted-foreground">
              {getPlanLabel(tenant.plan)}
            </p>
            <div className="mt-2">
              <StatusBadge subscriptionStatus={tenant.subscription_status} />
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <SuspenderTenantDialog tenant={tenant} acao="suspender" />
              <SuspenderTenantDialog tenant={tenant} acao="retomar" />
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}

function AuditoriaTable({
  entries,
  nomePorTenant,
}: {
  entries: StatusAuditEntry[];
  nomePorTenant: (tenantId: string) => string;
}) {
  return (
    <div className="rounded-lg border border-border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Data</TableHead>
            <TableHead>Empresa</TableHead>
            <TableHead>Mudança</TableHead>
            <TableHead>Motivo</TableHead>
            <TableHead>Autor</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {entries.map((entry) => (
            <TableRow key={entry.id}>
              <TableCell>{formatarDateTimeOperacao(entry.created_at)}</TableCell>
              <TableCell>{nomePorTenant(entry.tenant_id)}</TableCell>
              <TableCell>
                {getSubscriptionStatusLabel(entry.old_status)} →{" "}
                {getSubscriptionStatusLabel(entry.new_status)}
              </TableCell>
              <TableCell className="max-w-xs truncate">
                {entry.reason ?? "—"}
              </TableCell>
              <TableCell className="font-mono text-xs">
                {entry.changed_by ? entry.changed_by.slice(0, 8) : "sistema"}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

/**
 * Aba **Operação** do back-office (`/internal-admin/empresas`, ADR-11 / T1.4).
 * Cross-tenant só aqui (PRD §7): assinaturas membership com inadimplência
 * destacada, suspender/retomar a empresa (bloqueado → quitação) e a trilha de
 * auditoria da assinatura.
 *
 * Gating `backofficeT14`: `false`/`null` → painel legível bloqueado ("não
 * incluído") e **zero request** (todas as queries desabilitadas); falha de rede
 * no catálogo → painel "não foi possível verificar" com retry, também sem
 * request. Nunca trava a tela.
 */
export function OperacaoTab() {
  const gating = useBackofficeEntitlements();
  const liberado =
    gating.status === "ready" && gating.entitlements?.backofficeT14 === true;

  const assinaturasQuery = useBackofficeSubscriptions(liberado);
  const tenantsQuery = useAdminTenants({ enabled: liberado });
  const auditoriaQuery = useBackofficeStatusAudit(liberado);

  const tenants = useMemo(
    () => tenantsOperaveis(tenantsQuery.data ?? []),
    [tenantsQuery.data],
  );

  const nomePorTenant = useMemo(() => {
    const map = new Map(
      (tenantsQuery.data ?? []).map((tenant) => [tenant.id, displayName(tenant)]),
    );
    return (tenantId: string) => map.get(tenantId) ?? tenantId.slice(0, 8);
  }, [tenantsQuery.data]);

  const assinaturas = assinaturasQuery.data ?? [];
  const inadimplentes = assinaturas.filter(isInadimplente);

  if (gating.status === "loading") {
    return (
      <div className="space-y-2" aria-busy="true">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  if (gating.status === "error") {
    return (
      <StatePanel
        titulo="Não foi possível verificar o acesso ao back-office"
        descricao="Falha ao consultar o catálogo de planos (rede ou servidor). Nenhum dado da operação foi consultado; o acesso não pode ser confirmado."
      >
        <Button variant="outline" onClick={gating.retry}>
          Tentar novamente
        </Button>
      </StatePanel>
    );
  }

  if (!liberado) {
    return (
      <StatePanel
        titulo="Operação: recurso não incluído no plano atual"
        descricao="A aba de operação do back-office (assinaturas, inadimplência e suspensão) não está liberada para esta instalação. Nenhum dado foi consultado."
      />
    );
  }

  const carregando = assinaturasQuery.isLoading || tenantsQuery.isLoading;
  const erro = assinaturasQuery.isError || tenantsQuery.isError;

  return (
    <div className="space-y-6">
      {inadimplentes.length > 0 ? (
        <div
          role="status"
          className="rounded-md border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm"
        >
          <p className="font-medium text-destructive">
            {inadimplentes.length} assinatura(s) de cliente com inadimplência.
          </p>
          <p className="mt-1 text-muted-foreground">
            Revise a cobrança antes de suspender a empresa — a suspensão bloqueia
            o acesso operacional (bloqueado → quitação).
          </p>
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Assinaturas de clientes (membership)</CardTitle>
        </CardHeader>
        <CardContent>
          {carregando ? (
            <Skeleton className="h-32 w-full" />
          ) : assinaturasQuery.isError ? (
            <StatePanel
              titulo="Não foi possível carregar as assinaturas"
              descricao="Verifique a conexão e tente novamente."
            >
              <Button
                variant="outline"
                onClick={() => void assinaturasQuery.refetch()}
              >
                Tentar novamente
              </Button>
            </StatePanel>
          ) : assinaturas.length === 0 ? (
            <StatePanel
              titulo="Nenhuma assinatura de cliente"
              descricao="As assinaturas recorrentes dos clientes aparecem aqui."
            />
          ) : (
            <AssinaturasTable rows={assinaturas} />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Suspender ou retomar empresa</CardTitle>
        </CardHeader>
        <CardContent>
          {tenantsQuery.isLoading ? (
            <Skeleton className="h-32 w-full" />
          ) : tenantsQuery.isError ? (
            <StatePanel
              titulo="Não foi possível carregar as empresas"
              descricao="Verifique a conexão e tente novamente."
            >
              <Button variant="outline" onClick={() => void tenantsQuery.refetch()}>
                Tentar novamente
              </Button>
            </StatePanel>
          ) : tenants.length === 0 ? (
            <StatePanel
              titulo="Nenhuma empresa operável"
              descricao="Empresas ativas, pendentes ou bloqueadas aparecem aqui."
            />
          ) : (
            <EmpresasOperaveisTable tenants={tenants} />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Auditoria de assinatura</CardTitle>
        </CardHeader>
        <CardContent>
          {auditoriaQuery.isLoading ? (
            <Skeleton className="h-24 w-full" />
          ) : auditoriaQuery.isError ? (
            <StatePanel
              titulo="Não foi possível carregar a auditoria"
              descricao="Verifique a conexão e tente novamente."
            >
              <Button
                variant="outline"
                onClick={() => void auditoriaQuery.refetch()}
              >
                Tentar novamente
              </Button>
            </StatePanel>
          ) : (auditoriaQuery.data ?? []).length === 0 ? (
            <StatePanel
              titulo="Nenhuma mudança de assinatura"
              descricao="Suspensões e retomadas aparecem aqui com autor e motivo."
            />
          ) : (
            <AuditoriaTable
              entries={auditoriaQuery.data ?? []}
              nomePorTenant={nomePorTenant}
            />
          )}
        </CardContent>
      </Card>

      {erro ? (
        <p role="alert" className="sr-only">
          Falha ao carregar dados da operação.
        </p>
      ) : null}
    </div>
  );
}
