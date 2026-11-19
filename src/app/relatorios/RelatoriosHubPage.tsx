import { Link } from "react-router-dom";
import {
  CalendarCheck2,
  Coins,
  MessageCircleHeart,
  Repeat2,
  TicketPercent,
  UserX,
  Wallet,
  type LucideIcon,
} from "lucide-react";

import { PageHeader } from "@/components/PageHeader";
import { StatePanel } from "@/components/StatePanel";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { usePermissions } from "@/hooks/usePermissions";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useSegmentFeatures } from "@/hooks/useSegmentFeatures";
import { useRetentionSummary, useCohortHighlight, useWhatsappResponseRate, formatRate } from "@/hooks/useRetentionReports";
import { formatCentsToBRL } from "@/lib/money";
import { todayIsoInTenantTz, resolvePresetRange } from "@/app/relatorios/retention-period";
import { paymentsMessages } from "@/app/agenda/pagamentos/payments-messages";
import { cn } from "@/lib/utils";

interface ReportShortcut {
  to: string;
  titulo: string;
  descricao: string;
  icon: LucideIcon;
  /** Só aparece quando `true`. */
  visible: boolean;
}

/**
 * Hub de relatórios (`/app/relatorios`, ADR-08 + ADR-17). Ponto de extensão
 * para relatórios; hoje: Comissões, Financeiro e os 6 cards de retenção
 * (Rebooking/No-show/Utilização/Ticket médio/Retenção por coorte/WhatsApp,
 * RF-31) com métricas resumo do mês corrente e links para as 3 páginas.
 * Gated por segmento + RBAC (admin only para retenção); fora de acesso,
 * estado vazio honesto. A trava real de dados é o RLS.
 */
export function RelatoriosHubPage() {
  const { tenant } = useCurrentUser();
  const timeZone = tenant?.timezone ?? "America/Sao_Paulo";
  const { canViewCommission, canViewFinancials, isAdmin } = usePermissions();
  const { commission, payments } = useSegmentFeatures();

  const shortcuts: ReportShortcut[] = [
    {
      to: "/app/relatorios/comissoes",
      titulo: "Comissões",
      descricao: "Quanto cada barbeiro recebeu de comissão por período.",
      icon: Coins,
      visible: commission === true && canViewCommission,
    },
    {
      to: "/app/relatorios/financeiro",
      titulo: paymentsMessages.financialSummary.hubTitle,
      descricao: paymentsMessages.financialSummary.hubDescription,
      icon: Wallet,
      visible: canViewFinancials && payments === true,
    },
  ];

  const visibleShortcuts = shortcuts.filter((shortcut) => shortcut.visible);

  const today = todayIsoInTenantTz(timeZone);
  const monthRange = resolvePresetRange("mes", today);
  const monthFilter = isAdmin
    ? {
        startDate: monthRange.start,
        endDate: monthRange.end,
        professionalId: null,
        serviceId: null,
      }
    : { startDate: "", endDate: "", professionalId: null, serviceId: null };
  const summaryQuery = useRetentionSummary(monthFilter);
  const cohortQuery = useCohortHighlight(monthFilter);
  const whatsappQuery = useWhatsappResponseRate(monthFilter);
  const summaryLoading = isAdmin && summaryQuery.isLoading;
  const cohortLoading = isAdmin && cohortQuery.isLoading;
  const whatsappLoading = isAdmin && whatsappQuery.isLoading;
  const summary = isAdmin ? summaryQuery.data : undefined;
  const cohortRate = isAdmin ? cohortQuery.data?.retention_rate : undefined;
  const whatsappRate = isAdmin ? whatsappQuery.data?.response_rate : undefined;

  const retentionCards: {
    to: string;
    titulo: string;
    descricao: string;
    icon: LucideIcon;
    metric: string;
    ariaMetric: string;
  }[] = isAdmin
    ? [
        {
          to: "/app/relatorios/retencao",
          titulo: "Rebooking",
          descricao: "Clientes com 2+ visitas no mês e detalhes no período.",
          icon: Repeat2,
          metric: summaryLoading ? "…" : formatRate(summary?.rebooking_rate),
          ariaMetric: summaryLoading
            ? "carregando"
            : `Rebooking: ${formatRate(summary?.rebooking_rate)}`,
        },
        {
          to: "/app/relatorios/retencao",
          titulo: "No-show",
          descricao: "Faltas sobre agendamentos e detalhes no período.",
          icon: UserX,
          metric: summaryLoading ? "…" : formatRate(summary?.noshow_rate),
          ariaMetric: summaryLoading
            ? "carregando"
            : `No-show: ${formatRate(summary?.noshow_rate)}`,
        },
        {
          to: "/app/relatorios/utilizacao",
          titulo: "Utilização",
          descricao: "Minutos ocupados sobre minutos da grade.",
          icon: CalendarCheck2,
          metric: summaryLoading ? "…" : formatRate(summary?.utilization_rate),
          ariaMetric: summaryLoading
            ? "carregando"
            : `Utilização: ${formatRate(summary?.utilization_rate)}`,
        },
        {
          to: "/app/relatorios/ticket",
          titulo: "Ticket médio",
          descricao: "Receita por atendimento concluído no mês.",
          icon: TicketPercent,
          metric:
            summaryLoading || summary?.ticket_medio_cents == null
              ? summaryLoading
                ? "…"
                : "—"
              : formatCentsToBRL(summary.ticket_medio_cents),
          ariaMetric:
            summaryLoading
              ? "carregando"
              : summary?.ticket_medio_cents == null
                ? "Ticket médio sem dados"
                : `Ticket médio: ${formatCentsToBRL(summary.ticket_medio_cents)}`,
        },
        {
          to: "/app/relatorios/retencao",
          titulo: "Retenção por coorte",
          descricao: "Clientes da coorte do mês com visita na janela de 90 dias.",
          icon: MessageCircleHeart,
          metric: cohortLoading
            ? "…"
            : formatRate(cohortRate),
          ariaMetric: cohortLoading
            ? "carregando"
            : cohortRate == null
              ? "Retenção por coorte sem dados"
              : `Retenção por coorte: ${formatRate(cohortRate)}`,
        },
        {
          to: "/app/relatorios/retencao",
          titulo: "WhatsApp",
          descricao: "Respostas sobre enviadas no período (régua + campanhas).",
          icon: MessageCircleHeart,
          metric: whatsappLoading
            ? "…"
            : formatRate(whatsappRate),
          ariaMetric: whatsappLoading
            ? "carregando"
            : whatsappRate == null
              ? "Resposta no WhatsApp sem dados"
              : `Resposta no WhatsApp: ${formatRate(whatsappRate)}`,
        },
      ]
    : [];

  const hasAnyReport =
    visibleShortcuts.length > 0 || (isAdmin && retentionCards.length > 0);

  return (
    <div className="space-y-6">
      <PageHeader
        titulo="Relatórios"
        descricao="Os números que ajudam a entender a sua operação."
      />

      {!hasAnyReport ? (
        <StatePanel
          titulo="Nenhum relatório disponível ainda"
          descricao="Não há relatórios disponíveis para o seu ramo por enquanto."
        />
      ) : (
        <div className="space-y-8">
          {visibleShortcuts.length > 0 ? (
            <div className="grid gap-4 sm:grid-cols-2">
              {visibleShortcuts.map(({ to, titulo, descricao, icon: Icon }) => (
                <Link
                  key={`${to}-${titulo}`}
                  to={to}
                  className={cn(
                    "group rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                  )}
                >
                  <Card className="h-full transition-colors group-hover:border-primary/50">
                    <CardHeader>
                      <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-md bg-primary/10 text-primary">
                        <Icon className="h-5 w-5" aria-hidden="true" />
                      </div>
                      <CardTitle>{titulo}</CardTitle>
                      <CardDescription>{descricao}</CardDescription>
                    </CardHeader>
                  </Card>
                </Link>
              ))}
            </div>
          ) : null}

          {isAdmin && retentionCards.length > 0 ? (
            <section aria-labelledby="relatorios-retencao-titulo" className="space-y-4">
              <h2 id="relatorios-retencao-titulo" className="font-display text-lg font-semibold tracking-tight">
                Retenção
              </h2>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {retentionCards.map(({ to, titulo, descricao, icon: Icon, metric, ariaMetric }) => (
                  <Link
                    key={titulo}
                    to={to}
                    className={cn(
                      "group rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                    )}
                  >
                    <Card
                      className="h-full transition-colors group-hover:border-primary/50"
                      role="group"
                      aria-label={`${titulo}: ${ariaMetric}`}
                    >
                      <CardHeader>
                        <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-md bg-primary/10 text-primary">
                          <Icon className="h-5 w-5" aria-hidden="true" />
                        </div>
                        <CardTitle>{titulo}</CardTitle>
                        <CardDescription>{descricao}</CardDescription>
                      </CardHeader>
                      <CardContent>
                        {summaryLoading ? (
                          <div aria-busy="true" aria-label="Carregando métricas">
                            <Skeleton className="h-9 w-24" />
                          </div>
                        ) : (
                          <p className="font-display text-3xl font-semibold tabular-nums tracking-tight text-foreground">
                            {metric}
                          </p>
                        )}
                      </CardContent>
                    </Card>
                  </Link>
                ))}
              </div>
            </section>
          ) : null}
        </div>
      )}
    </div>
  );
}
