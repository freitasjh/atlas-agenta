import { useMemo, useState } from "react";

import { PageHeader } from "@/components/PageHeader";
import { StatePanel } from "@/components/StatePanel";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { usePermissions } from "@/hooks/usePermissions";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useProfile } from "@/hooks/useProfile";
import { useProfessionals } from "@/hooks/useProfessionals";
import {
  useDashboardSummary,
  type DashboardPeriod,
} from "@/hooks/useDashboardSummary";
import {
  tomorrowIsoInTenantTz,
  usePendingConfirmations,
} from "@/hooks/usePendingConfirmations";

import { HeroNoShowCard } from "@/app/dashboard/HeroNoShowCard";
import { KpiGrid } from "@/app/dashboard/KpiGrid";
import { PendingConfirmationTable } from "@/app/dashboard/PendingConfirmationTable";

/**
 * Painel operacional da agenda (`/app`, Fatia 1). Substitui o antigo
 * placeholder por uma ferramenta de decisão em pirâmide invertida: métrica-herói
 * de no-show, grade de KPIs de apoio e a tabela de exceções D-1 acionável — sem
 * gráfico (ADR-04) e sem nada financeiro (Fatia 2).
 *
 * A orquestração vive aqui: deriva `effectiveProfessionalId` (RBAC de UI, mesmo
 * padrão da AgendaPage — a trava real é o RLS), escolhe o período e chama os
 * dois hooks (resumo agregado + lista D-1). Cada bloco trata seus próprios
 * estados (loading = Skeleton/`aria-busy`, erro = StatePanel com "Tentar
 * novamente", vazio = zeros/"—"/copy pt-BR); um bloco que falha não derruba os
 * outros. Os três guards do layout já cuidam de auth/papel/assinatura — esta
 * página não os reimplementa.
 */

const PERIOD_OPTIONS: { value: DashboardPeriod; label: string }[] = [
  { value: "hoje", label: "Hoje" },
  { value: "semana", label: "Esta semana" },
  { value: "mes", label: "Este mês" },
];

export function DashboardPage() {
  const { canScheduleForAnyProfessional } = usePermissions();
  const { tenant } = useCurrentUser();
  const timeZone = tenant?.timezone ?? "America/Sao_Paulo";

  const { data: profile } = useProfile();
  const professionalsQuery = useProfessionals({ activeOnly: true });

  const [period, setPeriod] = useState<DashboardPeriod>("semana");

  // Profissional vinculado ao próprio login (quando `professional`). Mesmo
  // padrão `ownProfessional` da AgendaPage.
  const ownProfessional = useMemo(() => {
    if (canScheduleForAnyProfessional) return null;
    if (!profile) return null;
    return (
      professionalsQuery.data?.find((p) => p.profile_id === profile.id) ?? null
    );
  }, [canScheduleForAnyProfessional, profile, professionalsQuery.data]);

  // Admin/recepção → undefined (tenant inteiro); professional → só a própria
  // agenda. Conveniência de UI / defesa em profundidade; o RLS é a fronteira.
  const effectiveProfessionalId = canScheduleForAnyProfessional
    ? undefined
    : (ownProfessional?.id ?? undefined);

  const summaryQuery = useDashboardSummary({
    period,
    professionalId: effectiveProfessionalId,
  });
  const pendingQuery = usePendingConfirmations({
    professionalId: effectiveProfessionalId,
  });

  const tomorrowIso = tomorrowIsoInTenantTz(timeZone);

  return (
    <div className="space-y-6">
      <PageHeader
        titulo="Visão geral"
        descricao="A saúde da operação e o que precisa de você agora."
        acoes={
          <div className="space-y-1">
            <label htmlFor="dashboard-periodo" className="sr-only">
              Período
            </label>
            <Select
              value={period}
              onValueChange={(value) => setPeriod(value as DashboardPeriod)}
            >
              <SelectTrigger
                id="dashboard-periodo"
                className="w-[180px]"
                aria-label="Selecionar período"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PERIOD_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        }
      />

      {/* Bloco agregado: hero + KPIs. Loading/erro/vazio honestos por bloco. */}
      {summaryQuery.isLoading ? (
        <div className="space-y-4" aria-busy="true">
          <Skeleton className="h-48 w-full" />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Skeleton className="h-40 w-full" />
            <Skeleton className="h-40 w-full" />
            <Skeleton className="h-40 w-full" />
            <Skeleton className="h-40 w-full" />
            <Skeleton className="h-40 w-full" />
          </div>
        </div>
      ) : summaryQuery.isError ? (
        <StatePanel
          titulo="Não foi possível carregar o resumo"
          descricao="Verifique sua conexão e tente novamente."
        >
          <Button
            variant="outline"
            onClick={() => void summaryQuery.refetch()}
          >
            Tentar novamente
          </Button>
        </StatePanel>
      ) : summaryQuery.data ? (
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <div className="lg:col-span-1">
              <HeroNoShowCard
                current={summaryQuery.data.overview.current}
                previous={summaryQuery.data.overview.previous}
              />
            </div>
          </div>
          <KpiGrid summary={summaryQuery.data} />
        </div>
      ) : null}

      {/* Ponto de extensão do gráfico de tendência (ADR-04) entra aqui. */}

      {/* Bloco D-1: tabela de exceções acionável (hook/cache independente). */}
      <section className="space-y-3">
        <div className="space-y-1">
          <h2 className="font-display text-lg font-semibold tracking-tight">
            Confirmações pendentes para amanhã
          </h2>
          <p className="text-sm text-muted-foreground">
            Os agendamentos de amanhã que ainda aguardam confirmação.
          </p>
        </div>

        {pendingQuery.isLoading ? (
          <div className="space-y-2" aria-busy="true">
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-14 w-full" />
          </div>
        ) : pendingQuery.isError ? (
          <StatePanel
            titulo="Não foi possível carregar as confirmações de amanhã"
            descricao="Verifique sua conexão e tente novamente."
          >
            <Button
              variant="outline"
              onClick={() => void pendingQuery.refetch()}
            >
              Tentar novamente
            </Button>
          </StatePanel>
        ) : (
          <PendingConfirmationTable
            appointments={pendingQuery.data ?? []}
            timeZone={timeZone}
            tomorrowIso={tomorrowIso}
          />
        )}
      </section>
    </div>
  );
}
