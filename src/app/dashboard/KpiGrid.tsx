import { getAppointmentStatusLabel } from "@/components/StatusBadge";
import { APPOINTMENT_STATUSES } from "@/types/domain";

import type { DashboardSummary } from "@/hooks/useDashboardSummary";
import { DeltaBadge } from "@/app/dashboard/DeltaBadge";
import { KpiCard } from "@/app/dashboard/KpiCard";
import {
  formatCount,
  formatCountDelta,
  formatRate,
  formatRateDelta,
} from "@/app/dashboard/format";

/**
 * Faixa de KPIs de apoio (RF-DASH-02..06, AC-02). Grade mobile-first:
 * `grid-cols-1` → `sm:grid-cols-2` → `lg:grid-cols-3`. Cards:
 *   - Volume por status no período (quebra dos 6 estados).
 *   - Taxa de confirmação (eficácia da régua D-1).
 *   - Taxa de comparecimento.
 *   - Agendamentos por profissional (rótulo honesto, NÃO "Ocupação %").
 *   - Novos clientes no período.
 *
 * Nenhum KPI financeiro — `charges`/PIX é a Fatia 2 (AC-06). Os cards são
 * presentacionais; recebem os números já agregados no banco pela RPC.
 */

interface KpiGridProps {
  summary: DashboardSummary;
}

export function KpiGrid({ summary }: KpiGridProps) {
  const { overview, perProfessional } = summary;
  const { current, previous } = overview;

  const totalAgendados = current.total_agendados;

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {/* Volume por status no período */}
      <KpiCard
        rotulo="Agendamentos por status"
        valor={formatCount(totalAgendados)}
        apoio={`${
          totalAgendados === 1 ? "agendamento" : "agendamentos"
        } no período`}
        ariaLabel={`Agendamentos por status no período: ${formatCount(
          totalAgendados,
        )} no total. ${APPOINTMENT_STATUSES.map(
          (status) =>
            `${getAppointmentStatusLabel(status)}: ${formatCount(
              current.por_status[status],
            )}`,
        ).join(", ")}.`}
      >
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
          {APPOINTMENT_STATUSES.map((status) => (
            <div key={status} className="flex items-center justify-between gap-2">
              <dt className="text-muted-foreground">
                {getAppointmentStatusLabel(status)}
              </dt>
              <dd className="font-medium tabular-nums text-foreground">
                {formatCount(current.por_status[status])}
              </dd>
            </div>
          ))}
        </dl>
      </KpiCard>

      {/* Taxa de confirmação */}
      <KpiCard
        rotulo="Taxa de confirmação"
        valor={formatRate(current.confirmation_rate)}
        apoio="confirmados sobre pendentes + confirmados"
        ariaLabel={`Taxa de confirmação: ${formatRate(
          current.confirmation_rate,
        )} no período.`}
      >
        <DeltaBadge
          atual={current.confirmation_rate}
          anterior={previous.confirmation_rate}
          melhorQuando="sobe"
          formatarMagnitude={formatRateDelta}
        />
      </KpiCard>

      {/* Taxa de comparecimento */}
      <KpiCard
        rotulo="Taxa de comparecimento"
        valor={formatRate(current.attendance_rate)}
        apoio="concluídos sobre agendados do período"
        ariaLabel={`Taxa de comparecimento: ${formatRate(
          current.attendance_rate,
        )} no período.`}
      >
        <DeltaBadge
          atual={current.attendance_rate}
          anterior={previous.attendance_rate}
          melhorQuando="sobe"
          formatarMagnitude={formatRateDelta}
        />
      </KpiCard>

      {/* Novos clientes no período */}
      <KpiCard
        rotulo="Novos clientes"
        valor={formatCount(current.new_customers)}
        apoio="cadastrados no período"
        ariaLabel={`Novos clientes no período: ${formatCount(
          current.new_customers,
        )}.`}
      >
        <DeltaBadge
          atual={current.new_customers}
          anterior={previous.new_customers}
          melhorQuando="sobe"
          formatarMagnitude={formatCountDelta}
        />
      </KpiCard>

      {/* Agendamentos por profissional (volume, NÃO ocupação) */}
      <KpiCard
        rotulo="Agendamentos por profissional"
        valor={formatCount(
          perProfessional.reduce((sum, item) => sum + item.total, 0),
        )}
        apoio="volume no período (não é ocupação)"
        ariaLabel={`Agendamentos por profissional no período. ${
          perProfessional.length === 0
            ? "Nenhum agendamento no período."
            : perProfessional
                .map((item) => `${item.name}: ${formatCount(item.total)}`)
                .join(", ")
        }.`}
      >
        {perProfessional.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            Nenhum agendamento no período.
          </p>
        ) : (
          <dl className="space-y-1 text-xs">
            {perProfessional.map((item) => (
              <div
                key={item.professional_id}
                className="flex items-center justify-between gap-2"
              >
                <dt className="truncate text-muted-foreground">
                  {item.name}
                </dt>
                <dd className="shrink-0 font-medium tabular-nums text-foreground">
                  {formatCount(item.total)}
                </dd>
              </div>
            ))}
          </dl>
        )}
      </KpiCard>
    </div>
  );
}
