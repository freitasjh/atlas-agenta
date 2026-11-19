import { cn } from "@/lib/utils";

interface WeekDayOccupancyProps {
  /** `YYYY-MM-DD` do dia (para `data-testid`). */
  day: string;
  /** Agendados não-cancelados do dia (numerador, ADR-01). */
  occupied: number;
  /** Denominador: slots da grade ou estimado 08–18. */
  capacity: number;
  /** `%` arredondada (mesma conta do ResumoDoDia). */
  ocupacaoPct: number;
  /** `true` quando o denominador é estimado (sem grade). */
  estimated: boolean;
}

/**
 * Cabeçalho de ocupação do dia na semana (ADR-05): % em texto + apoio
 * "N de M" + mini-barra (`progressbar` com valores). Nunca só cor — o número
 * vai em texto e em `sr-only`. Sem nenhum R$ (receptionist vê % sem valor).
 * O `title` documenta o escopo: % intra-dia sobre os profissionais visíveis.
 */
export function WeekDayOccupancy({
  day,
  occupied,
  capacity,
  ocupacaoPct,
  estimated,
}: WeekDayOccupancyProps) {
  const apoio = `${occupied} de ${capacity} horário${capacity === 1 ? "" : "s"}${estimated ? " · estimado" : ""}`;
  return (
    <div
      data-testid={`week-day-occupancy-${day}`}
      className="space-y-1 px-2 pb-1"
      title="Ocupação do dia sobre os profissionais visíveis. Sem grade, o total é estimado (08–18)."
    >
      <p className="text-xs tabular-nums text-muted-foreground">
        <span className="font-display font-semibold text-foreground">
          {ocupacaoPct}%
        </span>{" "}
        <span aria-hidden="true">{apoio}</span>
        <span className="sr-only">{`Ocupação ${ocupacaoPct} por cento, ${apoio}.`}</span>
      </p>
      <div
        role="progressbar"
        aria-valuenow={ocupacaoPct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`Ocupação ${ocupacaoPct}%: ${apoio}`}
        className={cn("h-1 w-full overflow-hidden rounded-full bg-muted")}
      >
        <div
          aria-hidden="true"
          className="h-full rounded-full bg-primary"
          style={{ width: `${Math.min(100, Math.max(0, ocupacaoPct))}%` }}
        />
      </div>
    </div>
  );
}
