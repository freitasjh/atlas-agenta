import { Pencil, Trash2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

import type { ScheduleOverride } from "@/types/domain";

/** `HH:MM:SS`/`HH:MM` → `HH:MM` para exibição. */
function hm(value: string | null): string {
  return value ? value.slice(0, 5) : "";
}

/**
 * Formata `YYYY-MM-DD` (dia de calendário, sem fuso) como `dd/MM/yyyy` sem
 * passar por `Date`/UTC — evita o deslocamento de um dia que ocorreria ao
 * interpretar a data como meia-noite UTC.
 */
function formatOverrideDate(date: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return date;
  return `${match[3]}/${match[2]}/${match[1]}`;
}

/** Resumo da janela atípica (ex.: "09:00–14:00, intervalo 12:00–13:00"). */
function windowSummary(override: ScheduleOverride): string {
  const base = `${hm(override.start_time)}–${hm(override.end_time)}`;
  if (override.break_start && override.break_end) {
    return `${base}, intervalo ${hm(override.break_start)}–${hm(override.break_end)}`;
  }
  return base;
}

interface OverrideItemProps {
  override: ScheduleOverride;
  /** Leitura: esconde os botões de editar/remover. */
  readOnly: boolean;
  onEdit: (override: ScheduleOverride) => void;
  onDelete: (override: ScheduleOverride) => void;
}

/** Item da lista de exceções: data, badge de tipo, resumo e ações. */
export function OverrideItem({
  override,
  readOnly,
  onEdit,
  onDelete,
}: OverrideItemProps) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
      <div className="min-w-0 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium tabular-nums">
            {formatOverrideDate(override.override_date)}
          </span>
          {override.is_closed ? (
            <Badge variant="destructive">Folga</Badge>
          ) : (
            <Badge variant="secondary">Horário atípico</Badge>
          )}
        </div>
        <p className="truncate text-sm text-muted-foreground">
          {override.is_closed ? "Sem atendimento" : windowSummary(override)}
          {override.reason ? ` · ${override.reason}` : ""}
        </p>
      </div>

      {!readOnly ? (
        <div className="flex shrink-0 items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => onEdit(override)}
            aria-label={`Editar exceção de ${formatOverrideDate(override.override_date)}`}
          >
            <Pencil className="h-4 w-4" aria-hidden="true" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => onDelete(override)}
            aria-label={`Remover exceção de ${formatOverrideDate(override.override_date)}`}
          >
            <Trash2 className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>
      ) : null}
    </div>
  );
}
