import { useId, useMemo } from "react";
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

import { formatDateInTenantTz } from "@/lib/datetime";

import type { DashboardTrend } from "@/hooks/useDashboardSummary";

/**
 * Gráfico de tendência do painel (ADR-04, RF-DASH-07, AC-03). Mostra as últimas
 * ~6–8 semanas com duas séries por semana: agendamentos e não comparecimentos.
 *
 * É puramente presentacional: recebe a série `trend` já pronta de
 * `useDashboardSummary` (`{ week_start, agendados, nao_compareceu }[]`), não
 * busca dados e não reimplementa aritmética de fuso. Cada `week_start` é um
 * instante UTC (borda de semana derivada no cliente no fuso do tenant, D7 —
 * nunca `date_trunc('week')` cru); a exibição converte de volta para o fuso do
 * tenant só na borda, via `formatDateInTenantTz`.
 *
 * Cor da série de agendamentos = `hsl(var(--primary))` (jade). A segunda série
 * (no-show) distingue por **estilo de linha tracejada + legenda textual**, não
 * só por matiz, e usa o token de status `--status-nao-compareceu` (calibrado
 * AA ≥ 4.5:1 nos dois temas). O gráfico não é o único portador do dado — os
 * números-chave já vivem nos KpiCards —, então ganha `role="img"` + um
 * `aria-label` em pt-BR que resume a tendência para o leitor de tela.
 */

interface TrendChartProps {
  trend: DashboardTrend;
  timeZone: string;
}

interface TrendPoint {
  /** Rótulo curto do eixo X (dd/MM), no fuso do tenant. */
  label: string;
  agendados: number;
  naoCompareceu: number;
}

const AGENDADOS_COLOR = "hsl(var(--primary))";
const NO_SHOW_COLOR = "hsl(var(--status-nao-compareceu))";
const GRID_COLOR = "hsl(var(--border))";
const AXIS_COLOR = "hsl(var(--muted-foreground))";

export function TrendChart({ trend, timeZone }: TrendChartProps) {
  const titleId = useId();

  const points = useMemo<TrendPoint[]>(
    () =>
      trend.map((week) => ({
        // dd/MM da segunda-feira da semana, no fuso do tenant.
        label: formatDateInTenantTz(week.week_start, timeZone).slice(0, 5),
        agendados: week.agendados,
        naoCompareceu: week.nao_compareceu,
      })),
    [trend, timeZone],
  );

  // Resumo textual para o leitor de tela (AC-16): o gráfico não é o único
  // portador do dado, mas o leitor de tela precisa da tendência em pt-BR.
  const ariaLabel = useMemo(() => {
    if (points.length === 0) {
      return "Gráfico de tendência de agendamentos por semana. Sem dados no período.";
    }
    const agendados = points.map((p) => p.agendados);
    const min = Math.min(...agendados);
    const max = Math.max(...agendados);
    return (
      `Agendamentos por semana nas últimas ${points.length} semanas, ` +
      `variando de ${min} a ${max}. A linha tracejada mostra as faltas por semana.`
    );
  }, [points]);

  if (points.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Ainda não há semanas com histórico para montar a tendência.
      </p>
    );
  }

  return (
    <figure className="space-y-2">
      <figcaption id={titleId} className="sr-only">
        Agendamentos e faltas por semana nas últimas {points.length} semanas.
      </figcaption>
      <div
        role="img"
        aria-label={ariaLabel}
        className="h-[280px] w-full"
      >
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={points}
            margin={{ top: 8, right: 16, bottom: 0, left: -16 }}
          >
            <CartesianGrid
              stroke={GRID_COLOR}
              strokeDasharray="3 3"
              vertical={false}
            />
            <XAxis
              dataKey="label"
              stroke={AXIS_COLOR}
              tickLine={false}
              axisLine={{ stroke: GRID_COLOR }}
              fontSize={12}
            />
            <YAxis
              stroke={AXIS_COLOR}
              tickLine={false}
              axisLine={false}
              allowDecimals={false}
              width={32}
              fontSize={12}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: "hsl(var(--popover))",
                borderColor: GRID_COLOR,
                borderRadius: "0.5rem",
                color: "hsl(var(--popover-foreground))",
                fontSize: "0.75rem",
              }}
              labelStyle={{ color: "hsl(var(--popover-foreground))" }}
              cursor={{ stroke: GRID_COLOR }}
            />
            <Legend
              wrapperStyle={{ fontSize: "0.75rem", color: AXIS_COLOR }}
            />
            <Line
              type="monotone"
              dataKey="agendados"
              name="Agendamentos"
              stroke={AGENDADOS_COLOR}
              strokeWidth={2}
              dot={{ r: 2, fill: AGENDADOS_COLOR }}
              activeDot={{ r: 4 }}
              isAnimationActive={false}
            />
            <Line
              type="monotone"
              dataKey="naoCompareceu"
              name="Faltas"
              stroke={NO_SHOW_COLOR}
              strokeWidth={2}
              strokeDasharray="5 4"
              dot={{ r: 2, fill: NO_SHOW_COLOR }}
              activeDot={{ r: 4 }}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </figure>
  );
}
