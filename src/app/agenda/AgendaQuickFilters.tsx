import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { AgendaViewToggle, type AgendaView } from "@/app/agenda/AgendaViewToggle";

export interface AgendaQuickFiltersProps {
  day: string;
  todayIso: string;
  tomorrowIso: string;
  /** True quando a visão Semana está ativa (destaque de "Esta semana"). */
  weekAtiva: boolean;
  onSelectDay: (day: string) => void;
  onSelectWeek: () => void;
  aConfirmarAtivo: boolean;
  onToggleAConfirmar: () => void;
  view: AgendaView;
  onViewChange: (view: AgendaView) => void;
}

const QUICK_BUTTON =
  "min-h-[44px] aria-pressed:bg-primary aria-pressed:text-primary-foreground";

/**
 * Linha 1 de filtros (ADR-02 §2.2): Hoje / Amanhã / Esta semana + "A confirmar"
 * (`aria-pressed`) + o view toggle existente. Alvos ≥44px, `flex-wrap` para
 * 375px sem overflow.
 */
export function AgendaQuickFilters({
  day,
  todayIso,
  tomorrowIso,
  weekAtiva,
  onSelectDay,
  onSelectWeek,
  aConfirmarAtivo,
  onToggleAConfirmar,
  view,
  onViewChange,
}: AgendaQuickFiltersProps) {
  return (
    <div
      data-testid="agenda-quick-filters"
      className="flex min-w-0 flex-wrap items-center gap-2"
    >
      <div className="flex min-w-0 flex-wrap items-center gap-2" role="group" aria-label="Período rápido">
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-pressed={day === todayIso && !weekAtiva}
          onClick={() => onSelectDay(todayIso)}
          className={cn(QUICK_BUTTON)}
        >
          Hoje
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-pressed={day === tomorrowIso && !weekAtiva}
          onClick={() => onSelectDay(tomorrowIso)}
          className={cn(QUICK_BUTTON)}
        >
          Amanhã
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-pressed={weekAtiva}
          onClick={onSelectWeek}
          className={cn(QUICK_BUTTON)}
        >
          Esta semana
        </Button>
      </div>
      <Button
        type="button"
        variant={aConfirmarAtivo ? "default" : "outline"}
        size="sm"
        aria-pressed={aConfirmarAtivo}
        onClick={onToggleAConfirmar}
        className="min-h-[44px]"
      >
        A confirmar
      </Button>
      <AgendaViewToggle value={view} onChange={onViewChange} />
    </div>
  );
}
