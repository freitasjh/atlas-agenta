import { X } from "lucide-react";

import { Button } from "@/components/ui/button";

export interface FilterChip {
  /** Chave estável do filtro (ex.: "status", "servico"). */
  key: string;
  /** Rótulo pt-BR do valor ativo (ex.: "Pendente", "Corte"). */
  rotulo: string;
}

export interface AgendaFilterChipsProps {
  chips: FilterChip[];
  onRemove: (key: string) => void;
  onClearAll: () => void;
}

/**
 * Linha 2 de filtros (ADR-02 §2.2): chips removíveis + "Limpar tudo (N)".
 * Nada renderiza sem filtro ativo. Remoção por chip tem `aria-label` dedicado.
 */
export function AgendaFilterChips({ chips, onRemove, onClearAll }: AgendaFilterChipsProps) {
  if (chips.length === 0) return null;

  return (
    <div
      data-testid="agenda-filter-chips"
      aria-label="Filtros ativos"
      className="flex min-w-0 flex-wrap items-center gap-2"
    >
      {chips.map((chip) => (
        <span
          key={chip.key}
          className="inline-flex min-h-[44px] items-center gap-1 rounded-full border border-border bg-secondary py-1 pl-3 pr-1 text-sm text-secondary-foreground"
        >
          <span className="max-w-[180px] truncate">{chip.rotulo}</span>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={`Remover filtro ${chip.rotulo}`}
            onClick={() => onRemove(chip.key)}
            className="h-9 w-9 min-h-[36px] min-w-[36px] rounded-full"
          >
            <X aria-hidden="true" className="h-4 w-4" />
          </Button>
        </span>
      ))}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={onClearAll}
        className="min-h-[44px]"
      >
        {`Limpar tudo (${chips.length})`}
      </Button>
    </div>
  );
}
