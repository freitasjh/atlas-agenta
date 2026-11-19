import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { formatCentsToBRL } from "@/lib/money";

/**
 * Gráficos do DRE + fluxo (carregados por `lazy` na página). Recharts é pesado:
 * fica fora do bundle inicial. Cada gráfico é decorativo para leitor de tela
 * (`role="img"` + rótulo) — a tabela alternativa irmã é a fonte de verdade
 * acessível. Respeita `prefers-reduced-motion` (sem animação).
 */

function tickBRL(cents: number): string {
  const reais = cents / 100;
  if (Math.abs(reais) >= 1000) {
    return `R$ ${(reais / 1000).toFixed(1).replace(".", ",")} mil`;
  }
  return `R$ ${Math.round(reais)}`;
}

export interface DreMensalDatum {
  label: string;
  resultado_cents: number;
  acumulado_cents: number;
}

export function DreMensalChart({
  data,
  ariaLabel,
}: {
  data: DreMensalDatum[];
  ariaLabel: string;
}) {
  return (
    <div role="img" aria-label={ariaLabel} className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
          <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
          <XAxis dataKey="label" tick={{ fontSize: 12 }} interval={0} />
          <YAxis tick={{ fontSize: 12 }} width={64} tickFormatter={tickBRL} />
          <Tooltip
            formatter={(value, name) => [
              formatCentsToBRL(Number(value)),
              name === "acumulado_cents" ? "Acumulado" : "Resultado",
            ]}
          />
          <Legend
            formatter={(value) => (value === "acumulado_cents" ? "Acumulado" : "Resultado")}
          />
          <Bar
            dataKey="resultado_cents"
            name="resultado_cents"
            fill="hsl(var(--primary))"
            radius={[4, 4, 0, 0]}
            maxBarSize={48}
            isAnimationActive={false}
          />
          <Line
            type="monotone"
            dataKey="acumulado_cents"
            name="acumulado_cents"
            stroke="hsl(var(--foreground))"
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

export interface FluxoDatum {
  label: string;
  entradas_cents: number;
  saidas_cents: number;
  saldo_acumulado_cents: number;
}

export function FluxoChart({
  data,
  ariaLabel,
}: {
  data: FluxoDatum[];
  ariaLabel: string;
}) {
  return (
    <div role="img" aria-label={ariaLabel} className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
          <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
          <XAxis dataKey="label" tick={{ fontSize: 11 }} interval={4} />
          <YAxis tick={{ fontSize: 12 }} width={64} tickFormatter={tickBRL} />
          <Tooltip
            formatter={(value, name) => [
              formatCentsToBRL(Number(value)),
              name === "saldo_acumulado_cents"
                ? "Saldo acumulado"
                : name === "entradas_cents"
                  ? "Entradas"
                  : "Saídas",
            ]}
          />
          <Legend
            formatter={(value) =>
              value === "saldo_acumulado_cents"
                ? "Saldo acumulado"
                : value === "entradas_cents"
                  ? "Entradas"
                  : "Saídas"
            }
          />
          <Bar
            dataKey="entradas_cents"
            name="entradas_cents"
            fill="hsl(var(--primary))"
            radius={[3, 3, 0, 0]}
            maxBarSize={16}
            isAnimationActive={false}
          />
          <Bar
            dataKey="saidas_cents"
            name="saidas_cents"
            fill="hsl(var(--destructive))"
            radius={[3, 3, 0, 0]}
            maxBarSize={16}
            isAnimationActive={false}
          />
          <Line
            type="monotone"
            dataKey="saldo_acumulado_cents"
            name="saldo_acumulado_cents"
            stroke="hsl(var(--foreground))"
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
