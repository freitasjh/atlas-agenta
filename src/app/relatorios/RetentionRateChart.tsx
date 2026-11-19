import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { RateChartDatum } from "@/app/relatorios/RetentionChart";
import { formatRate } from "@/hooks/useRetentionReports";
import { formatCentsToBRL } from "@/lib/money";

/**
 * Barras Recharts (carregado por lazy em `RetentionChart`). Decorativo para
 * leitor de tela (`aria-hidden`) — a tabela acessível irmã é a fonte de
 * verdade. Respeita `prefers-reduced-motion` (sem animação).
 */
export function RetentionRateChart({
  data,
  ariaLabel,
  unit = "percent",
}: {
  data: RateChartDatum[];
  ariaLabel: string;
  unit?: "percent" | "currency";
}) {
  const chartData = data.map((item) => ({
    name:
      item.label.length > 14 ? `${item.label.slice(0, 13)}…` : item.label,
    fullName: item.label,
    value:
      item.rate === null
        ? 0
        : unit === "percent"
          ? Math.round(item.rate * 1000) / 10
          : Math.round(item.rate / 100),
  }));
  const reduceMotion =
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  return (
    <div
      role="img"
      aria-label={ariaLabel}
      aria-hidden="false"
      className="h-64 w-full"
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={chartData}
          margin={{ top: 8, right: 8, bottom: 24, left: 8 }}
        >
          <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
          <XAxis
            dataKey="name"
            tick={{ fontSize: 12 }}
            interval={0}
            angle={-20}
            dy={8}
            height={48}
          />
          <YAxis
            tick={{ fontSize: 12 }}
            width={48}
            tickFormatter={(value: number) =>
              unit === "percent" ? `${value}%` : String(value)
            }
          />
          <Tooltip
            formatter={(value) => {
              const numeric = Number(value);
              if (unit === "percent") return [`${numeric}%`, "Taxa"];
              return [formatCentsToBRL(numeric * 100), "Ticket médio"];
            }}
            labelFormatter={(_, payload) => {
              const first = payload?.[0]?.payload as
                | { fullName?: string }
                | undefined;
              return first?.fullName ?? "";
            }}
          />
          <Bar
            dataKey="value"
            fill="var(--primary)"
            radius={[4, 4, 0, 0]}
            isAnimationActive={!reduceMotion}
          />
        </BarChart>
      </ResponsiveContainer>
      <p className="sr-only">
        {data
          .map((item) =>
            unit === "currency"
              ? `${item.label}: ${item.rate === null ? "sem dados" : formatCentsToBRL(Math.round(item.rate))}`
              : `${item.label}: ${formatRate(item.rate)}`,
          )
          .join("; ")}
      </p>
    </div>
  );
}
