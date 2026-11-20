import { useMemo } from "react";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";

import { AppointmentBlock } from "@/app/agenda/AppointmentBlock";
import { WeekDayOccupancy } from "@/app/agenda/WeekDayOccupancy";
import {
  summarizeWeekDays,
  type WeekDayOccupancySummary,
} from "@/app/agenda/model/weekOccupancy";
import type { PaymentsMessages } from "@/app/agenda/pagamentos/payments-messages";
import type { AgendaPaymentFlag } from "@/hooks/useAgendaPaymentFlags";
import { Button } from "@/components/ui/button";
import { SchedulePanel } from "@/app/agenda/schedule/ScheduleSurface";
import { toTenantLocal, weekRangeOf } from "@/lib/datetime";
import { cn } from "@/lib/utils";
import type {
  AppointmentWithRelations,
  Professional,
  WorkingHour,
} from "@/types/domain";

/** `YYYY-MM-DD` (zero-pad) do `starts_at` no fuso do tenant. */
function tenantDayKey(utcIso: string, timeZone: string): string {
  const { year, month, day } = toTenantLocal(utcIso, timeZone);
  const mm = String(month).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  return `${year}-${mm}-${dd}`;
}

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
  /** Dia em foco (`YYYY-MM-DD`); sua coluna recebe apenas realce visual. */
  day: string;
  timeZone: string;
  /**
   * Agendamentos da **semana inteira** (os 7 dias). O componente os distribui
   * por coluna agrupando por `starts_at` convertido ao fuso do tenant.
   */
  appointments: AppointmentWithRelations[];
  /**
   * Base cheia da semana para a % de ocupação (sem recortes de UX como
   * serviço/status — espelho da `summaryBaseQuery` da ADR-02). Ausente =
   * usa `appointments`. As lanes seguem sempre com `appointments` (filtrada).
   */
  occupancyAppointments?: AppointmentWithRelations[];
  /** `YYYY-MM-DD` de hoje no fuso do tenant, para destacar a coluna. */
  todayIso: string;
  /** Pode exibir a linha de comissão nos blocos (gating resolvido no pai). */
  showCommission?: boolean;
  /** Troca o dia em foco (clicar numa coluna navega a semana). */
  onSelectDay: (day: string) => void;
  /** Abre o diálogo de edição. */
  onOpenAppointment: (appointment: AppointmentWithRelations) => void;
  /** Flags de pagamento por atendimento (pass-through, sem lógica). */
  paymentFlags?: ReadonlyMap<string, AgendaPaymentFlag>;
  /** Abre o settlement do atendimento. */
  onOpenPayment?: (appointment: AppointmentWithRelations) => void;
  /** Catálogo de mensagens repassado aos blocos. */
  paymentsMessages?: PaymentsMessages;
  /** Capacidade do cliente de registrar pagamentos (ação "Pagamento"). */
  canRegisterPayments?: boolean;
  /**
   * Profissionais visíveis no filtro atual (para o corte grade×cards e o
   * denominador de ocupação). Ausente = derivados dos agendamentos.
   */
  professionals?: Professional[];
  /**
   * Grade semanal (`working_hours`) para o denominador real de ocupação.
   * Ausente/vazia = estimado 08–18 com apoio "estimado" (sem request nova).
   */
  workingHours?: WorkingHour[];
}

/**
 * Visão **semana**: 7 colunas de dia (segunda→domingo), sempre visíveis — uma
 * coluna sem agendamento não colapsa, mostra um rótulo de vazio discreto. Os
 * agendamentos recebidos (`appointments`) são os da semana inteira, buscados
 * numa única request (RNF01), e distribuídos por coluna agrupando-os pelo dia
 * local (`starts_at` no fuso do tenant). A coluna do dia em foco recebe apenas
 * **realce** (não filtra as demais); clicar numa coluna move o foco.
 *
 * No desktop (`sm+`) há paridade de navegação com a Lista/Dia: **‹ Semana
 * anterior** / **Próxima semana ›** movem o foco em ±7 dias (mesmo weekday) e
 * **"Hoje"** volta ao dia atual no fuso do tenant. O date-picker "ir para data"
 * não é duplicado aqui — já é servido pela barra da `AgendaPage`.
 *
 * No mobile (abaixo de `sm`) a grade de 7 colunas não cabe em 360px, então
 * degrada para **uma coluna de dia navegável por setas** (anterior/próximo
 * movem o dia em foco em ±1 e carregam aquele dia), com o % de ocupação do
 * dia em foco no topo.
 *
 * O dia de hoje é destacado por peso + `text-primary` (nunca só por cor — há o
 * número do dia e o rótulo textual). Os horários dos blocos vêm no fuso do
 * tenant (AC-16).
 */
export function AgendaCalendarWeek({
  day,
  timeZone,
  appointments,
  occupancyAppointments,
  todayIso,
  showCommission = false,
  onSelectDay,
  onOpenAppointment,
  paymentFlags,
  onOpenPayment,
  paymentsMessages,
  canRegisterPayments = false,
  professionals,
  workingHours = [],
}: AgendaCalendarWeekProps) {
  // Monta a semana (segunda a domingo) que contém o dia em foco. Mesma fonte
  // única (`weekRangeOf`) que a `AgendaPage` usa para buscar o intervalo, então
  // as colunas renderizadas nunca divergem dos dados buscados (ADR-04).
  const weekDays = useMemo(() => weekRangeOf(day)?.days ?? [day], [day]);

  // Rótulo do intervalo da semana (ex.: "12 – 18/08"), para contexto no
  // cabeçalho de navegação. Usa o número do dia + mês do domingo, sem fuso.
  const weekRangeLabel = useMemo(() => {
    const first = weekDays[0];
    const last = weekDays[weekDays.length - 1];
    const month = last.slice(5, 7);
    return `${dayNumber(first)} – ${dayNumber(last)}/${month}`;
  }, [weekDays]);

  // Agrupa os agendamentos da semana por dia local (fuso do tenant). Cada lane
  // fica ordenada pelo instante absoluto (`starts_at` UTC comparável).
  const byDay = useMemo(() => {
    const map = new Map<string, AppointmentWithRelations[]>();
    for (const appointment of appointments) {
      const key = tenantDayKey(appointment.starts_at, timeZone);
      const lane = map.get(key);
      if (lane) {
        lane.push(appointment);
      } else {
        map.set(key, [appointment]);
      }
    }
    for (const lane of map.values()) {
      lane.sort(
        (a, b) =>
          new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime(),
      );
    }
    return map;
  }, [appointments, timeZone]);

  /** Renderiza a lane de um dia (`YYYY-MM-DD`): blocos ou rótulo de vazio. */
  const renderLane = (columnDay: string) => {
    const lane = byDay.get(columnDay) ?? [];
    if (lane.length === 0) {
      return (
        <p className="px-1 py-2 text-xs text-muted-foreground">
          Sem agendamentos.
        </p>
      );
    }
    return lane.map((appointment) => (
      <div key={appointment.id} className="h-16">
        <AppointmentBlock
          appointment={appointment}
          timeZone={timeZone}
          compact
          showCommission={showCommission}
          onOpen={onOpenAppointment}
          paymentFlag={paymentFlags?.get(appointment.id)}
          onOpenPayment={onOpenPayment}
          messages={paymentsMessages}
          canRegisterPayments={canRegisterPayments}
        />
      </div>
    ));
  };

  // Profissionais visíveis: do filtro (pai) ou derivados da lane. O corte
  // grade×cards (ADR-05) usa essa lista — ≤3 mostra a grade real (uma
  // sub-lane por profissional), >3 lista os blocos em cards.
  const visibleProfessionalIds = useMemo(() => {
    if (professionals && professionals.length > 0) {
      return professionals.map((p) => p.id);
    }
    return [...new Set(appointments.map((a) => a.professional_id))];
  }, [professionals, appointments]);
  const gradeMode = visibleProfessionalIds.length <= 3;

  // % de ocupação por dia, client-side sobre os 7 dias já buscados (sem
  // request nova). Usa a base cheia (`occupancyAppointments`) para o numerador
  // — o filtro de recorte (serviço/status) refina as lanes sem encolher a %,
  // espelhando a `summaryBaseQuery` da ADR-02. Mesma conta do ResumoDoDia
  // (ADR-01) para o mesmo fixture.
  const summariesByDay = useMemo(() => {
    const occupancySource = occupancyAppointments ?? appointments;
    const summaries = summarizeWeekDays({
      appointments: occupancySource,
      weekDays,
      timeZone,
      workingHours,
      professionalIds:
        professionals && professionals.length > 0
          ? professionals.map((p) => p.id)
          : [],
    });
    return new Map<string, WeekDayOccupancySummary>(
      summaries.map((s) => [s.day, s]),
    );
  }, [occupancyAppointments, appointments, weekDays, timeZone, workingHours, professionals]);

  /** Nome do profissional para a sub-lane (prop ou relação da linha). */
  function professionalName(professionalId: string): string {
    return (
      professionals?.find((p) => p.id === professionalId)?.name ??
      appointments.find((a) => a.professional_id === professionalId)
        ?.professionals?.name ??
      "Outros"
    );
  }

  /**
   * Lane em modo grade (≤3 visíveis): uma sub-lane por profissional, com o
   * nome como rótulo. Agendamentos fora da lista visível caem em "Outros".
   */
  const renderGradeLane = (columnDay: string) => {
    const lane = byDay.get(columnDay) ?? [];
    if (lane.length === 0) {
      return (
        <p className="px-1 py-2 text-xs text-muted-foreground">
          Sem agendamentos.
        </p>
      );
    }
    const known = new Set(visibleProfessionalIds);
    const groups = visibleProfessionalIds.map((id) => ({
      id,
      items: lane.filter((a) => a.professional_id === id),
    }));
    const orphans = lane.filter((a) => !known.has(a.professional_id));
    if (orphans.length > 0) {
      groups.push({ id: "__outros__", items: orphans });
    }
    return groups
      .filter((g) => g.items.length > 0)
      .map((group) => (
        <div
          key={group.id}
          data-testid={`week-grade-${group.id}`}
          className="space-y-1 border-t border-dashed border-border/60 pt-1 first:border-t-0 first:pt-0"
        >
          <p className="px-1 text-[11px] font-medium text-muted-foreground">
            {group.id === "__outros__"
              ? "Outros"
              : professionalName(group.id)}
          </p>
          {group.items.map((appointment) => (
            <div key={appointment.id} className="h-16">
              <AppointmentBlock
                appointment={appointment}
                timeZone={timeZone}
                compact
                showCommission={showCommission}
                onOpen={onOpenAppointment}
                paymentFlag={paymentFlags?.get(appointment.id)}
                onOpenPayment={onOpenPayment}
                messages={paymentsMessages}
                canRegisterPayments={canRegisterPayments}
              />
            </div>
          ))}
        </div>
      ));
  };

  /** Cabeçalho de ocupação do dia (texto + barra, sem R$). */
  const renderOccupancy = (columnDay: string) => {
    const summary = summariesByDay.get(columnDay);
    if (!summary) return null;
    return (
      <WeekDayOccupancy
        day={columnDay}
        occupied={summary.occupied}
        capacity={summary.capacity}
        ocupacaoPct={summary.ocupacaoPct}
        estimated={summary.estimated}
      />
    );
  };

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
        <div className="flex flex-col gap-1 p-1">
          {renderOccupancy(day)}
          {gradeMode ? renderGradeLane(day) : renderLane(day)}
        </div>
      </div>

      {/* sm+: navegação por semana (±7 + Hoje) + grade de 7 colunas. */}
      <SchedulePanel className="hidden sm:block">
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
                  "border-b border-border/80 px-2 py-2.5 text-center text-xs transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
                  isFocus ? "bg-primary/5" : undefined,
                  isToday ? "text-primary" : "text-muted-foreground",
                )}
              >
                <span className="block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {WEEKDAY_SHORT[weekday]}
                </span>
                <span
                  className={cn(
                    "mx-auto mt-1 flex size-7 items-center justify-center rounded-full font-mono text-xs font-bold tabular-nums",
                    isToday
                      ? "bg-primary text-primary-foreground"
                      : "text-foreground",
                  )}
                >
                  {dayNumber(columnDay)}
                </span>
                <span className="mt-1 block text-[10px] text-muted-foreground">
                  {(byDay.get(columnDay) ?? []).length}{" "}
                  {(byDay.get(columnDay) ?? []).length === 1
                    ? "agendado"
                    : "agendados"}
                </span>
              </button>
              {renderOccupancy(columnDay)}

              <div className="flex flex-col gap-1 p-1">
                {gradeMode ? renderGradeLane(columnDay) : renderLane(columnDay)}
              </div>
            </div>
          );
        })}
      </div>
      </div>
      </SchedulePanel>
    </>
  );
}
