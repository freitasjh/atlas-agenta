import { useMemo } from "react";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";

import { AppointmentBlock } from "@/app/agenda/AppointmentBlock";
import { Button } from "@/components/ui/button";
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

const WEEKDAY_LONG: Record<number, string> = {
  0: "domingo",
  1: "segunda-feira",
  2: "terça-feira",
  3: "quarta-feira",
  4: "quinta-feira",
  5: "sexta-feira",
  6: "sábado",
};

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
 * Visão **semana**: 7 colunas de dia (segunda→domingo), sempre visíveis — uma
 * coluna sem agendamento não colapsa, mostra um rótulo de vazio discreto. Para
 * não abrir sete requests (RNF01), a semana compartilha a MESMA query do dia em
 * foco — só a coluna do dia selecionado mostra os agendamentos; as demais ficam
 * explicitamente vazias. Clicar numa coluna move o foco e carrega aquele dia.
 *
 * No desktop (`sm+`) há paridade de navegação com a Lista/Dia: **‹ Semana
 * anterior** / **Próxima semana ›** movem o foco em ±7 dias (mesmo weekday) e
 * **"Hoje"** volta ao dia atual no fuso do tenant. O date-picker "ir para data"
 * não é duplicado aqui — já é servido pela barra da `AgendaPage`.
 *
 * No mobile (abaixo de `sm`) a grade de 7 colunas não cabe em 360px, então
 * degrada para **uma coluna de dia navegável por setas** (anterior/próximo
 * movem o dia em foco em ±1 e carregam aquele dia).
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

  // Rótulo do intervalo da semana (ex.: "12 – 18/08"), para contexto no
  // cabeçalho de navegação. Usa o número do dia + mês do domingo, sem fuso.
  const weekRangeLabel = useMemo(() => {
    const first = weekDays[0];
    const last = weekDays[weekDays.length - 1];
    const month = last.slice(5, 7);
    return `${dayNumber(first)} – ${dayNumber(last)}/${month}`;
  }, [weekDays]);

  // Ordena os agendamentos do dia em foco por início (UTC comparável).
  const focusedAppointments = useMemo(
    () =>
      [...appointments].sort(
        (a, b) =>
          new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime(),
      ),
    [appointments],
  );

  const focusedLane =
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
    );

  const focusWeekdayLong = WEEKDAY_LONG[weekdayOf(day)] ?? "";

  return (
    <>
      {/* Mobile (abaixo de sm): dia único navegável por setas. */}
      <div className="rounded-lg border border-border bg-card sm:hidden">
        <div className="flex items-center justify-between border-b border-border p-2">
          <Button
            variant="outline"
            size="icon"
            aria-label="Dia anterior"
            onClick={() => onSelectDay(shiftIsoDate(day, -1))}
          >
            <ChevronLeft aria-hidden="true" />
          </Button>
          <div className="text-center">
            <span className="block text-xs capitalize text-muted-foreground">
              {focusWeekdayLong}
            </span>
            <span
              className={cn(
                "block font-mono text-sm tabular-nums",
                day === todayIso ? "font-semibold text-primary" : "text-foreground",
              )}
            >
              {dayNumber(day)}
            </span>
          </div>
          <Button
            variant="outline"
            size="icon"
            aria-label="Próximo dia"
            onClick={() => onSelectDay(shiftIsoDate(day, 1))}
          >
            <ChevronRight aria-hidden="true" />
          </Button>
        </div>
        <div className="flex flex-col gap-1 p-1">{focusedLane}</div>
      </div>

      {/* sm+: navegação por semana (±7 + Hoje) + grade de 7 colunas. */}
      <div className="hidden overflow-hidden rounded-lg border border-border bg-card sm:block">
      {/* Cabeçalho de navegação, em paridade com a barra da Lista/Dia. */}
      <div className="flex items-center justify-between gap-2 border-b border-border p-2">
        <Button
          variant="outline"
          size="sm"
          aria-label="Semana anterior"
          onClick={() => onSelectDay(shiftIsoDate(day, -7))}
        >
          <ChevronLeft aria-hidden="true" />
          Semana anterior
        </Button>
        <span className="text-sm font-medium text-foreground tabular-nums">
          {weekRangeLabel}
        </span>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            aria-label="Ir para hoje"
            onClick={() => onSelectDay(todayIso)}
          >
            <CalendarDays aria-hidden="true" />
            Hoje
          </Button>
          <Button
            variant="outline"
            size="sm"
            aria-label="Próxima semana"
            onClick={() => onSelectDay(shiftIsoDate(day, 7))}
          >
            Próxima semana
            <ChevronRight aria-hidden="true" />
          </Button>
        </div>
      </div>
      <div className="overflow-x-auto">
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
                  focusedLane
                ) : (
                  <p className="px-1 py-2 text-xs text-muted-foreground/70">
                    —
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>
      </div>
      </div>
    </>
  );
}
