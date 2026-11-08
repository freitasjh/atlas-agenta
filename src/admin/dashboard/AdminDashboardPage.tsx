import { useMemo, useState } from "react";

import { PageHeader } from "@/components/PageHeader";
import { StatePanel } from "@/components/StatePanel";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StatusBadge, getSubscriptionStatusLabel } from "@/components/StatusBadge";
import { getPlanLabel } from "@/lib/subscription-status";
import { PLAN_SLUGS } from "@/lib/plans";
import {
  SUBSCRIPTION_STATUSES,
  type TenantListItem,
} from "@/types/domain";
import {
  computeAdminKpis,
  filterAdminTenants,
  useAdminAppointmentsMonthCount,
  useAdminDashboardTenants,
  useAdminWhatsAppInstances,
  type AdminTenantPlanFilter,
  type AdminTenantStatusFilter,
} from "@/hooks/useAdminDashboard";
import { currentTelemetryMonth } from "@/hooks/usePlanTelemetry";
import { PlanMrrCard } from "@/admin/dashboard/PlanMrrCard";

function displayName(tenant: TenantListItem): string {
  const trade = tenant.trade_name?.trim();
  return trade && trade.length > 0 ? trade : tenant.legal_name;
}

function formatDateTime(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(date);
}

export function AdminDashboardPage() {
  const tenantsQuery = useAdminDashboardTenants();
  const instancesQuery = useAdminWhatsAppInstances();
  const appointmentsQuery = useAdminAppointmentsMonthCount();

  const [statusFilter, setStatusFilter] = useState<AdminTenantStatusFilter>("todos");
  const [planFilter, setPlanFilter] = useState<AdminTenantPlanFilter>("todos");
  const [telemetryMonth, setTelemetryMonth] = useState<string>(() => currentTelemetryMonth());

  const tenants = useMemo(() => tenantsQuery.data ?? [], [tenantsQuery.data]);
  const instances = useMemo(() => instancesQuery.data ?? [], [instancesQuery.data]);

  const kpis = useMemo(
    () => computeAdminKpis(tenants, instances, appointmentsQuery.data ?? null),
    [tenants, instances, appointmentsQuery.data],
  );

  const filteredTenants = useMemo(
    () => filterAdminTenants(tenants, { status: statusFilter, plan: planFilter }),
    [tenants, statusFilter, planFilter],
  );

  const disconnectedInstances = useMemo(
    () => instances.filter((i) => i.connection_status !== "conectado"),
    [instances],
  );

  const isLoading = tenantsQuery.isLoading || instancesQuery.isLoading;
  const isError = tenantsQuery.isError || instancesQuery.isError;

  return (
    <div className="space-y-6">
      <PageHeader
        titulo="Painel do super admin"
        descricao="Visão consolidada da plataforma (somente leitura)."
      />

      {isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-busy="true">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
      ) : isError ? (
        <StatePanel
          titulo="Não foi possível carregar o dashboard"
          descricao="Verifique a conexão e tente novamente."
        >
          <Button
            variant="outline"
            onClick={() => {
              void tenantsQuery.refetch();
              void instancesQuery.refetch();
            }}
          >
            Tentar novamente
          </Button>
        </StatePanel>
      ) : (
        <>
          {/* KPIs */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Card>
              <CardContent className="space-y-1 p-5">
                <p className="text-sm text-muted-foreground">Empresas</p>
                <p className="font-display text-3xl font-semibold tabular-nums">
                  {kpis.total}
                </p>
                <p className="text-xs text-muted-foreground">
                  {SUBSCRIPTION_STATUSES.map(
                    (s) => `${kpis.byStatus[s]} ${getSubscriptionStatusLabel(s).toLowerCase()}`,
                  ).join(" · ")}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="space-y-1 p-5">
                <p className="text-sm text-muted-foreground">Trials vencendo (7 dias)</p>
                <p className="font-display text-3xl font-semibold tabular-nums">
                  {kpis.trialsExpiring7d}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="space-y-1 p-5">
                <p className="text-sm text-muted-foreground">Empresas bloqueadas</p>
                <p className="font-display text-3xl font-semibold tabular-nums">
                  {kpis.blocked}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="space-y-1 p-5">
                <p className="text-sm text-muted-foreground">WhatsApp desconectado</p>
                <p className="font-display text-3xl font-semibold tabular-nums">
                  {kpis.disconnectedWhatsApp}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="space-y-1 p-5">
                <p className="text-sm text-muted-foreground">Agendamentos no mês</p>
                <p className="font-display text-3xl font-semibold tabular-nums">
                  {kpis.appointmentsThisMonth === null
                    ? "—"
                    : kpis.appointmentsThisMonth}
                </p>
              </CardContent>
            </Card>
          </div>

          {/* Telemetria de planos (Arquétipo A — Card 1: MRR + quota) */}
          <div className="space-y-2">
            <div className="w-full sm:w-56">
              <Label htmlFor="telemetria-mes-dashboard">Mês da telemetria</Label>
              <Input
                id="telemetria-mes-dashboard"
                type="month"
                value={telemetryMonth}
                onChange={(e) => setTelemetryMonth(e.target.value)}
              />
            </div>
            <PlanMrrCard month={telemetryMonth} />
          </div>

          {/* Filtros */}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="w-full sm:w-56">
              <label htmlFor="filtro-status-dashboard" className="sr-only">
                Filtrar por status
              </label>
              <Select
                value={statusFilter}
                onValueChange={(v) => setStatusFilter(v as AdminTenantStatusFilter)}
              >
                <SelectTrigger id="filtro-status-dashboard">
                  <SelectValue placeholder="Filtrar por status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todos os status</SelectItem>
                  {SUBSCRIPTION_STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {getSubscriptionStatusLabel(s)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="w-full sm:w-56">
              <label htmlFor="filtro-plano-dashboard" className="sr-only">
                Filtrar por plano
              </label>
              <Select
                value={planFilter}
                onValueChange={(v) => setPlanFilter(v as AdminTenantPlanFilter)}
              >
                <SelectTrigger id="filtro-plano-dashboard">
                  <SelectValue placeholder="Filtrar por plano" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todos os planos</SelectItem>
                  {PLAN_SLUGS.map((p) => (
                    <SelectItem key={p} value={p}>
                      {getPlanLabel(p)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Tabela empresas recentes */}
          <div className="space-y-2">
            <h2 className="text-lg font-semibold">Empresas recentes</h2>
            {filteredTenants.length === 0 ? (
              <StatePanel
                titulo="Nenhuma empresa encontrada"
                descricao="Ajuste os filtros para ver outras empresas."
              />
            ) : (
              <div className="rounded-lg border border-border">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="p-3 text-left font-medium">Empresa</th>
                      <th className="p-3 text-left font-medium">Plano</th>
                      <th className="p-3 text-left font-medium">Status</th>
                      <th className="p-3 text-left font-medium">Fim do trial</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredTenants.slice(0, 10).map((t) => (
                      <tr key={t.id} className="border-b border-border last:border-0">
                        <td className="p-3">{displayName(t)}</td>
                        <td className="p-3">{getPlanLabel(t.plan)}</td>
                        <td className="p-3">
                          <StatusBadge subscriptionStatus={t.subscription_status} />
                        </td>
                        <td className="p-3 tabular-nums">
                          {t.trial_ends_at
                            ? new Intl.DateTimeFormat("pt-BR", {
                                dateStyle: "medium",
                                timeZone: t.timezone || "America/Sao_Paulo",
                              }).format(new Date(t.trial_ends_at))
                            : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Tabela WhatsApp desconectado */}
          <div className="space-y-2">
            <h2 className="text-lg font-semibold">Instâncias WhatsApp não conectadas</h2>
            {disconnectedInstances.length === 0 ? (
              <StatePanel
                titulo="Nenhuma instância desconectada"
                descricao="Todas as instâncias conectadas ou ainda não cadastradas."
              />
            ) : (
              <div className="rounded-lg border border-border">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="p-3 text-left font-medium">Tenant</th>
                      <th className="p-3 text-left font-medium">Status</th>
                      <th className="p-3 text-left font-medium">Última conexão</th>
                    </tr>
                  </thead>
                  <tbody>
                    {disconnectedInstances.map((i) => (
                      <tr key={i.tenant_id} className="border-b border-border last:border-0">
                        <td className="p-3">{i.trade_name ?? i.tenant_id}</td>
                        <td className="p-3">{i.connection_status}</td>
                        <td className="p-3 tabular-nums">
                          {formatDateTime(i.last_connected_at)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
