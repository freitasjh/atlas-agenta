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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import {
  computeUsageKpis,
  filterUsageTenantsByStatusAndPlan,
  isDateRangeValid,
  useAdminUsageOverview,
  useAdminUsageSeries,
  useAdminUsageTenants,
  type UsageBucket,
  type UsageSeriesPoint,
} from "@/hooks/useAdminUsageMetrics";
import { getPlanLabel, getSubscriptionTransitionLabel } from "@/lib/subscription-status";
import { PLAN_SLUGS, type PlanSlug } from "@/lib/plans";
import { useAdminTenants } from "@/hooks/useAdminTenants";
import { StatusBadge } from "@/components/StatusBadge";
import { SUBSCRIPTION_STATUSES, type SubscriptionStatus } from "@/types/domain";

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function thirtyDaysAgoIso(): string {
  const d = new Date();
  d.setDate(d.getDate() - 30);
  return d.toISOString().slice(0, 10);
}

export function MetricasPage() {
  const [start, setStart] = useState<string>(thirtyDaysAgoIso());
  const [end, setEnd] = useState<string>(todayIso());
  const [bucket, setBucket] = useState<UsageBucket>("day");
  const [planFilter, setPlanFilter] = useState<PlanSlug | "todos">("todos");
  const [statusFilter, setStatusFilter] = useState<SubscriptionStatus | "todos">("todos");

  const overviewQuery = useAdminUsageOverview(start, end);
  const seriesQuery = useAdminUsageSeries(start, end, bucket);
  const tenantsUsageQuery = useAdminUsageTenants(start, end);
  const tenantsQuery = useAdminTenants();

  const kpis = useMemo(
    () => computeUsageKpis(overviewQuery.data ?? null),
    [overviewQuery.data],
  );

  const filteredUsageTenants = useMemo(
    () =>
      filterUsageTenantsByStatusAndPlan(
        tenantsUsageQuery.data ?? [],
        tenantsQuery.data ?? [],
        statusFilter,
        planFilter,
      ),
    [tenantsUsageQuery.data, tenantsQuery.data, statusFilter, planFilter],
  );

  const dateRangeValid = isDateRangeValid(start, end);

  const isError =
    overviewQuery.isError ||
    seriesQuery.isError ||
    tenantsUsageQuery.isError ||
    tenantsQuery.isError;

  const statusCounts = useMemo(() => {
    const counts = SUBSCRIPTION_STATUSES.reduce(
      (acc, s) => {
        acc[s] = 0;
        return acc;
      },
      {} as Record<SubscriptionStatus, number>,
    );
    for (const tenant of tenantsQuery.data ?? []) {
      counts[tenant.subscription_status] += 1;
    }
    return counts;
  }, [tenantsQuery.data]);

  const isLoading =
    overviewQuery.isLoading || seriesQuery.isLoading || tenantsUsageQuery.isLoading;

  const points: UsageSeriesPoint[] = seriesQuery.data ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        titulo="Métricas de uso"
        descricao="Visão aprofundada de uso da plataforma (somente leitura)."
      />

      {/* Filtros */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="w-full sm:w-44">
          <Label htmlFor="metricas-start">Início</Label>
          <Input
            id="metricas-start"
            type="date"
            value={start}
            onChange={(e) => setStart(e.target.value)}
          />
        </div>
        <div className="w-full sm:w-44">
          <Label htmlFor="metricas-end">Fim</Label>
          <Input
            id="metricas-end"
            type="date"
            value={end}
            onChange={(e) => setEnd(e.target.value)}
          />
        </div>
        <div className="w-full sm:w-40">
          <Label htmlFor="metricas-bucket">Agrupar por</Label>
          <Select
            value={bucket}
            onValueChange={(v) => setBucket(v as UsageBucket)}
          >
            <SelectTrigger id="metricas-bucket">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="day">Dia</SelectItem>
              <SelectItem value="week">Semana</SelectItem>
              <SelectItem value="month">Mês</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="w-full sm:w-44">
          <Label htmlFor="metricas-plan">Plano</Label>
          <Select
            value={planFilter}
            onValueChange={(v) => setPlanFilter(v as PlanSlug | "todos")}
          >
            <SelectTrigger id="metricas-plan">
              <SelectValue />
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
        <div className="w-full sm:w-44">
          <Label htmlFor="metricas-status">Status</Label>
          <Select
            value={statusFilter}
            onValueChange={(v) => setStatusFilter(v as SubscriptionStatus | "todos")}
          >
            <SelectTrigger id="metricas-status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos os status</SelectItem>
              {SUBSCRIPTION_STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  {getSubscriptionTransitionLabel(s)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button
          variant="outline"
          onClick={() => {
            void overviewQuery.refetch();
            void seriesQuery.refetch();
            void tenantsUsageQuery.refetch();
          }}
        >
          Atualizar
        </Button>
      </div>

      {!dateRangeValid ? (
        <StatePanel
          titulo="Período inválido"
          descricao="A data inicial deve ser anterior ou igual à data final."
        />
      ) : isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-busy="true">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
      ) : isError ? (
        <StatePanel
          titulo="Não foi possível carregar as métricas"
          descricao="Verifique a conexão e tente novamente."
        >
          <Button
            variant="outline"
            onClick={() => {
              void overviewQuery.refetch();
              void seriesQuery.refetch();
              void tenantsUsageQuery.refetch();
              void tenantsQuery.refetch();
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
                <p className="text-sm text-muted-foreground">Agendamentos</p>
                <p className="font-display text-3xl font-semibold tabular-nums">
                  {kpis.totalAppointments}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="space-y-1 p-5">
                <p className="text-sm text-muted-foreground">No-show</p>
                <p className="font-display text-3xl font-semibold tabular-nums">
                  {kpis.noShowRate.toFixed(1)}%
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="space-y-1 p-5">
                <p className="text-sm text-muted-foreground">Confirmação</p>
                <p className="font-display text-3xl font-semibold tabular-nums">
                  {kpis.confirmationRate.toFixed(1)}%
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="space-y-1 p-5">
                <p className="text-sm text-muted-foreground">Uso WhatsApp</p>
                <p className="font-display text-3xl font-semibold tabular-nums">
                  {kpis.whatsappUsage}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="space-y-1 p-5">
                <p className="text-sm text-muted-foreground">Novas empresas</p>
                <p className="font-display text-3xl font-semibold tabular-nums">
                  {kpis.newTenants}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="space-y-1 p-5">
                <p className="text-sm text-muted-foreground">Retenção</p>
                <p className="font-display text-3xl font-semibold tabular-nums">
                  {kpis.retentionRate.toFixed(1)}%
                </p>
                <p className="text-xs text-muted-foreground">
                  {kpis.retentionActive} ativas · {kpis.retentionCancelled} canceladas
                </p>
              </CardContent>
            </Card>
          </div>

          {/* Contagem por status */}
          <Card>
            <CardContent className="space-y-1 p-5">
              <p className="text-sm text-muted-foreground">Empresas por status</p>
              <p className="text-xs text-muted-foreground">
                {SUBSCRIPTION_STATUSES.map(
                  (s) =>
                    `${statusCounts[s]} ${getSubscriptionTransitionLabel(s).toLowerCase()}`,
                ).join(" · ")}
              </p>
            </CardContent>
          </Card>

          {/* Gráfico tendência */}
          <Card>
            <CardContent className="p-5">
              <h2 className="mb-3 text-lg font-semibold">Tendência</h2>
              {points.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Sem dados no período.
                </p>
              ) : (
                <div className="h-[300px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={points}>
                      <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="bucket" tick={{ fontSize: 12 }} />
                      <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                      <Tooltip />
                      <Legend />
                      <Line
                        type="monotone"
                        dataKey="appointments"
                        name="Agendamentos"
                        stroke="hsl(var(--primary))"
                        strokeWidth={2}
                        dot={false}
                      />
                      <Line
                        type="monotone"
                        dataKey="no_show"
                        name="No-show"
                        stroke="hsl(var(--status-nao-compareceu))"
                        strokeWidth={2}
                        strokeDasharray="5 4"
                        dot={false}
                      />
                      <Line
                        type="monotone"
                        dataKey="confirmed"
                        name="Confirmados"
                        stroke="hsl(var(--status-confirmado))"
                        strokeWidth={2}
                        dot={false}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Tabela por tenant */}
          <div className="space-y-2">
            <h2 className="text-lg font-semibold">Por empresa</h2>
            {filteredUsageTenants.length === 0 ? (
              <StatePanel
                titulo="Nenhuma empresa com dados"
                descricao="Ajuste o período ou os filtros."
              />
            ) : (
              <div className="rounded-lg border border-border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Empresa</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Agendamentos</TableHead>
                      <TableHead>No-show</TableHead>
                      <TableHead>WhatsApp</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredUsageTenants.map((row) => {
                      const tenant = (tenantsQuery.data ?? []).find(
                        (t) => t.id === row.tenant_id,
                      );
                      return (
                        <TableRow key={row.tenant_id}>
                          <TableCell>{row.trade_name ?? row.tenant_id}</TableCell>
                          <TableCell>
                            {tenant ? (
                              <StatusBadge subscriptionStatus={tenant.subscription_status} />
                            ) : (
                              "—"
                            )}
                          </TableCell>
                          <TableCell className="tabular-nums">{row.appointments}</TableCell>
                          <TableCell className="tabular-nums">{row.no_show}</TableCell>
                          <TableCell className="tabular-nums">{row.whatsapp}</TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
