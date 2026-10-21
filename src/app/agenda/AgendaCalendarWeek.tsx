import { useMemo } from "react";

import { AppointmentBlock } from "@/app/agenda/AppointmentBlock";
import { cn } from "@/lib/utils";
import type { AppointmentWithRelations } from "@/types/domain";

/** Ordem de exibição (segunda→domingo), igual à grade em `WeekScheduleForm`. */
const DISPLAY_ORDER = [1, 2, 3, 4, 5, 6, 0] as const;
const WEEKDAY_SHORT: Record<number, string> = {
  0: "dom",
  1: "seg",
  2: "ter",
  3: "qua",
  4: "qui",
  5: "sex",
  6: "sáb",
};

/** `YYYY-MM-DD` → weekday (0=domingo), independente de fuso. */
function weekdayOf(day: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!match) return -1;
  return new Date(
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])),
  ).getUTCDay();
}

/** Soma `days` a um `YYYY-MM-DD` (aritmética de calendário, sem fuso). */
function shiftIsoDate(day: string, days: number): string {
  const [y, m, d] = day.split("-").map(Number);
  const base = new Date(Date.UTC(y, m - 1, d));
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString().slice(0, 10);
}

/** Dia do mês (número) de um `YYYY-MM-DD`. */
function dayNumber(day: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  return match ? Number(match[3]) : 0;
}

interface AgendaCalendarWeekProps {
  /** Dia em foco (`YYYY-MM-DD`); a coluna dele é a que tem dados carregados. */
  day: string;
  timeZone: string;
  /** Agendamentos do dia em foco (mesma query da lista — sem request novo). */
  appointments: AppointmentWithRelations[];
  /** `YYYY-MM-DD` de hoje no fuso do tenant, para destacar a coluna. */
  todayIso: string;
  /** Troca o dia em foco (clicar numa coluna navega a semana). */
  onSelectDay: (day: string) => void;
  /** Abre o diálogo de edição. */
  onOpenAppointment: (appointment: AppointmentWithRelations) => void;
}

/**
 * Visão **semana**: 7 colunas de dia (segunda→domingo). Para não abrir sete
 * requests (RNF01), a semana compartilha a MESMA query do dia em foco — só a
 * coluna do dia selecionado mostra os agendamentos; clicar noutra coluna move o
 * foco e carrega aquele dia. No mobile a grade degrada para uma coluna de dia
 * navegável (7 colunas não cabem em 360px), com setas no `AgendaPage`.
 *
 * O dia de hoje é destacado por peso + `text-primary` (nunca só por cor — há o
 * número do dia e o rótulo textual). Os horários dos blocos vêm no fuso do
 * tenant (AC-16).
 */
export function AgendaCalendarWeek({
  day,
  timeZone,
  appointments,
  todayIso,
  onSelectDay,
  onOpenAppointment,
}: AgendaCalendarWeekProps) {
  // Monta a semana (segunda a domingo) que contém o dia em foco.
  const weekDays = useMemo(() => {
    const focusWeekday = weekdayOf(day);
    const positionInOrder = DISPLAY_ORDER.indexOf(
      focusWeekday as (typeof DISPLAY_ORDER)[number],
    );
    const monday = shiftIsoDate(day, -positionInOrder);
    return DISPLAY_ORDER.map((_, index) => shiftIsoDate(monday, index));
  }, [day]);

  // Ordena os agendamentos do dia em foco por início (UTC comparável).
  const focusedAppointments = useMemo(
    () =>
      [...appointments].sort(
        (a, b) =>
          new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime(),
      ),
    [appointments],
  );

  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-card">
      <div className="grid min-w-[640px] grid-cols-7">
        {weekDays.map((columnDay) => {
          const isFocus = columnDay === day;
          const isToday = columnDay === todayIso;
          const weekday = weekdayOf(columnDay);
          return (
            <div
              key={columnDay}
              className={cn(
                "flex min-h-[8rem] flex-col border-l border-border first:border-l-0",
                isFocus ? "bg-muted/20" : undefined,
              )}
            >
              <button
                type="button"
                onClick={() => onSelectDay(columnDay)}
                aria-pressed={isFocus}
                aria-label={`${WEEKDAY_SHORT[weekday]} ${dayNumber(columnDay)}`}
                className={cn(
                  "border-b border-border px-2 py-2 text-center text-xs transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
                  isToday
                    ? "font-semibold text-primary"
                    : "text-muted-foreground",
                )}
              >
                <span className="block capitalize">
                  {WEEKDAY_SHORT[weekday]}
                </span>
                <span className="block font-mono text-sm tabular-nums text-foreground">
                  {dayNumber(columnDay)}
                </span>
              </button>

              <div className="flex flex-col gap-1 p-1">
                {isFocus ? (
                  focusedAppointments.length > 0 ? (
                    focusedAppointments.map((appointment) => (
                      <div key={appointment.id} className="h-16">
                        <AppointmentBlock
                          appointment={appointment}
                          timeZone={timeZone}
                          compact
                          onOpen={onOpenAppointment}
                        />
                      </div>
                    ))
                  ) : (
                    <p className="px-1 py-2 text-xs text-muted-foreground">
                      Sem agendamentos.
                    </p>
                  )
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
