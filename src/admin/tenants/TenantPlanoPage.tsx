import { Link, useParams } from "react-router-dom";

import { PageHeader } from "@/components/PageHeader";
import { StatePanel } from "@/components/StatePanel";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { getPlan } from "@/lib/plans";
import { isValidTenantId, useAdminTenant } from "@/hooks/useAdminTenants";
import { useTenantPlanUsage } from "@/hooks/useSetPlan";
import { usePlanHistory } from "@/hooks/usePlanHistory";
import { TrocarPlanoDialog } from "@/admin/empresas/TrocarPlanoDialog";

function formatDateTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString("pt-BR");
  } catch {
    return iso;
  }
}

/**
 * Tela de plano do tenant (`/admin/tenants/:id/plano`): plano atual + uso +
 * histórico auditado (desc, com ator/data/motivo). Fase 1 sem scheduler: nenhum
 * "pendente/agendado" é exibido. Estados Skeleton/Empty/Error em pt-BR.
 */
export function TenantPlanoPage() {
  const { id } = useParams<{ id: string }>();
  const validId = isValidTenantId(id) ? (id as string) : null;
  const tenantQuery = useAdminTenant(validId);
  const usageQuery = useTenantPlanUsage(validId);
  const historyQuery = usePlanHistory(validId);

  const tenant = tenantQuery.data ?? null;

  if (!validId) {
    return (
      <div className="space-y-6">
        <PageHeader titulo="Plano da empresa" descricao="Troca de plano auditada." />
        <StatePanel titulo="Empresa inválida" descricao="O identificador da empresa é inválido." />
      </div>
    );
  }

  if (tenantQuery.isLoading) {
    return (
      <div className="space-y-6" aria-busy="true">
        <PageHeader titulo="Plano da empresa" descricao="Troca de plano auditada." />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  if (tenantQuery.isError || !tenant) {
    return (
      <div className="space-y-6">
        <PageHeader titulo="Plano da empresa" descricao="Troca de plano auditada." />
        <StatePanel
          titulo="Não foi possível carregar a empresa"
          descricao="Verifique a conexão e tente novamente."
        >
          <Button variant="outline" onClick={() => void tenantQuery.refetch()}>
            Tentar novamente
          </Button>
        </StatePanel>
      </div>
    );
  }

  const display = tenant.trade_name?.trim() ? tenant.trade_name : tenant.legal_name;

  return (
    <div className="space-y-6">
      <PageHeader
        titulo={`Plano — ${display}`}
        descricao="Plano atual, uso no mês e histórico de trocas."
      />
      <div>
        <Button variant="outline" asChild className="min-h-[44px]">
          <Link to="/admin/empresas">← Voltar para empresas</Link>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Plano atual</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge>📦 {getPlan(tenant.plan).nome}</Badge>
            <Badge variant="outline">Uso no mês: {usageQuery.data ? `${usageQuery.data.month_key}` : "—"}</Badge>
          </div>
          {usageQuery.isLoading ? (
            <Skeleton className="h-10 w-full" />
          ) : usageQuery.data ? (
            <p className="text-sm tabular-nums text-muted-foreground">
              👥 {usageQuery.data.active_professionals} profissionais ativos · 📅{" "}
              {usageQuery.data.month_appointments} agendamentos no mês
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">Uso indisponível no momento.</p>
          )}
          <TrocarPlanoDialog tenant={tenant} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Histórico de trocas</CardTitle>
        </CardHeader>
        <CardContent>
          {historyQuery.isLoading ? (
            <Skeleton className="h-24 w-full" />
          ) : historyQuery.isError ? (
            <StatePanel
              titulo="Não foi possível carregar o histórico"
              descricao="Verifique a conexão e tente novamente."
            >
              <Button variant="outline" onClick={() => void historyQuery.refetch()}>
                Tentar novamente
              </Button>
            </StatePanel>
          ) : (historyQuery.data ?? []).length === 0 ? (
            <StatePanel
              titulo="Nenhuma troca registrada"
              descricao="As trocas de plano aparecem aqui com ator, data e motivo."
            />
          ) : (
            <ol className="space-y-3">
              {(historyQuery.data ?? []).map((row) => (
                <li key={row.id} className="rounded-md border p-3 text-sm">
                  <p className="font-medium tabular-nums">
                    {getPlan(row.old_plan).nome} → {getPlan(row.new_plan).nome}
                    {row.override_flag ? " · acima do limite" : ""}
                  </p>
                  <p className="mt-1 text-muted-foreground">{row.reason}</p>
                  <p className="mt-1 text-xs text-muted-foreground tabular-nums">
                    {formatDateTime(row.created_at)}
                    {row.changed_by ? ` · ${row.changed_by.slice(0, 8)}` : ""}
                  </p>
                </li>
              ))}
            </ol>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
