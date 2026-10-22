import { useMemo } from "react";

import { AppointmentBlock } from "@/app/agenda/AppointmentBlock";
import { toTenantLocal } from "@/lib/datetime";
import type {
  AppointmentWithRelations,
  Professional,
  WorkingHour,
} from "@/types/domain";

/** Altura em px de uma hora na calha (densidade da grade). */
const HOUR_HEIGHT = 56;
/** Janela padrão quando não há grade nem agendamentos (08h–18h). */
const DEFAULT_START_HOUR = 8;
const DEFAULT_END_HOUR = 18;
/** Altura mínima de um bloco para continuar legível (px). */
const MIN_BLOCK_HEIGHT = 22;

/** Minutos desde a meia-noite do dia (fuso do tenant) de um instante UTC. */
function minutesOfDay(utcIso: string, timeZone: string): number {
  const { hour, minute } = toTenantLocal(utcIso, timeZone);
  return hour * 60 + minute;
}

/** `HH:MM` → minutos desde a meia-noite; `null` se inválido. */
function hhmmToMinutes(time: string | null): number | null {
  if (!time) return null;
  const match = /^(\d{2}):(\d{2})/.exec(time);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

interface Column {
  professional: Professional | null;
  appointments: AppointmentWithRelations[];
}

interface AgendaCalendarDayProps {
  day: string;
  timeZone: string;
  appointments: AppointmentWithRelations[];
  /** Colunas por profissional quando admin/recepção veem "todos". */
  professionals: Professional[];
  /** `true` quando o usuário só vê a própria agenda (uma coluna, sem cabeçalho). */
  singleColumn: boolean;
  /** Grade do(s) profissional(is) para desenhar a faixa de expediente do dia. */
  workingHours: WorkingHour[];
  /** Weekday (0=domingo) do dia no fuso do tenant. */
  weekday: number;
  /** Abre o diálogo de edição com o mesmo menu de ações da lista. */
  onOpenAppointment: (appointment: AppointmentWithRelations) => void;
  /** Criar a partir de uma faixa vazia: profissional + `HH:MM` do clique. */
  onCreateAt?: (professionalId: string | null, time: string) => void;
}

/**
 * Visão **dia** da agenda: calha de horas vertical (tabular-nums), faixa de
 * expediente distinta da faixa sem expediente, **linha do agora** em jade
 * (`bg-primary`) quando o dia é hoje, e blocos proporcionais à duração com
 * borda da cor do status. Admin/recepção veem uma coluna por profissional;
 * `professional` vê uma coluna única (o RLS já filtra).
 *
 * Mobile-first (RNF02): a janela de horas é só do primeiro ao último expediente
 * (ou dos agendamentos), nunca 00–24. Clicar numa faixa vazia abre a criação
 * com profissional + início pré-preenchidos (role `button`, `aria-label`).
 */
export function AgendaCalendarDay({
  day,
  timeZone,
  appointments,
  professionals,
  singleColumn,
  workingHours,
  weekday,
  onOpenAppointment,
  onCreateAt,
}: AgendaCalendarDayProps) {
  // Janela de horas a renderizar: do primeiro expediente/agendamento ao último.
  const { startHour, endHour } = useMemo(() => {
    const dayHours = workingHours.filter((wh) => wh.weekday === weekday);
    const starts: number[] = [];
    const ends: number[] = [];
    for (const wh of dayHours) {
      const s = hhmmToMinutes(wh.start_time);
      const e = hhmmToMinutes(wh.end_time);
      if (s != null) starts.push(s);
      if (e != null) ends.push(e);
    }
    for (const appointment of appointments) {
      starts.push(minutesOfDay(appointment.starts_at, timeZone));
      ends.push(minutesOfDay(appointment.ends_at, timeZone));
    }
    if (starts.length === 0 || ends.length === 0) {
      return { startHour: DEFAULT_START_HOUR, endHour: DEFAULT_END_HOUR };
    }
    const minStart = Math.floor(Math.min(...starts) / 60);
    const maxEnd = Math.ceil(Math.max(...ends) / 60);
    return {
      startHour: Math.max(0, minStart),
      endHour: Math.min(24, Math.max(maxEnd, minStart + 1)),
    };
  }, [workingHours, weekday, appointments, timeZone]);

  const hours = useMemo(() => {
    const out: number[] = [];
    for (let h = startHour; h <= endHour; h += 1) out.push(h);
    return out;
  }, [startHour, endHour]);

  const gridHeight = (endHour - startHour) * HOUR_HEIGHT;
  const startMinutes = startHour * 60;

  // Faixas de expediente do dia (para a sombra "aqui atende").
  const workingWindows = useMemo(() => {
    return workingHours
      .filter((wh) => wh.weekday === weekday)
      .map((wh) => ({
        start: hhmmToMinutes(wh.start_time),
        end: hhmmToMinutes(wh.end_time),
      }))
      .filter(
        (w): w is { start: number; end: number } =>
          w.start != null && w.end != null && w.end > w.start,
      );
  }, [workingHours, weekday]);

  // Linha do "agora" (só quando o dia em foco é hoje no fuso do tenant).
  const nowMinutes = useMemo(() => {
    const now = new Date();
    const todayParts = toTenantLocal(now, timeZone);
    const todayIso = `${todayParts.year.toString().padStart(4, "0")}-${todayParts.month
      .toString()
      .padStart(2, "0")}-${todayParts.day.toString().padStart(2, "0")}`;
    if (todayIso !== day) return null;
    return todayParts.hour * 60 + todayParts.minute;
  }, [day, timeZone]);

  const columns: Column[] = singleColumn
    ? [{ professional: null, appointments }]
    : professionals.map((professional) => ({
        professional,
        appointments: appointments.filter(
          (a) => a.professional_id === professional.id,
        ),
      }));

  // Agendamentos de profissionais fora da lista ativa (ex.: inativos) ainda
  // aparecem numa coluna "Outros" para não sumirem da visão.
  if (!singleColumn) {
    const known = new Set(professionals.map((p) => p.id));
    const orphans = appointments.filter((a) => !known.has(a.professional_id));
    if (orphans.length > 0) {
      columns.push({ professional: null, appointments: orphans });
    }
  }

  /** Minutos desde a meia-noite → `HH:MM`. */
  function minutesToHhmm(minutes: number): string {
    const hour = Math.floor(minutes / 60);
    const minute = minutes % 60;
    return `${hour.toString().padStart(2, "0")}:${minute
      .toString()
      .padStart(2, "0")}`;
  }

  /**
   * Converte o clique (pointer) numa faixa de uma hora em `HH:MM` arredondado a
   * 30 min. `baseMinutes` é o início da faixa; `offsetY` é relativo a ela. Na
   * ativação por teclado (Enter/Espaço), `offsetY` chega 0 e cai no início da
   * faixa focada — por isso cada hora é um botão próprio, dando ao operador
   * só-teclado um horário específico (o do botão em foco).
   */
  function timeFromHourOffset(baseMinutes: number, offsetY: number): string {
    const rawMinutes = baseMinutes + (offsetY / HOUR_HEIGHT) * 60;
    const snapped = Math.max(
      startMinutes,
      Math.min(endHour * 60, Math.round(rawMinutes / 30) * 30),
    );
    return minutesToHhmm(snapped);
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-card">
      {/* Cabeçalho de colunas (só multi-profissional). */}
      {!singleColumn ? (
        <div className="flex border-b border-border">
          <div className="w-14 shrink-0" aria-hidden="true" />
          {columns.map((column, index) => (
            <div
              key={column.professional?.id ?? `outros-${index}`}
              className="flex-1 border-l border-border px-2 py-2 text-center text-sm font-medium text-foreground"
            >
              {column.professional?.name ?? "Outros"}
            </div>
          ))}
        </div>
      ) : null}

      <div className="flex">
        {/* Calha de horas: cada rótulo posicionado na MESMA coordenada da
            hairline da coluna (`top = (hour - startHour) * HOUR_HEIGHT`),
            centrado na linha via `translateY(-50%)`, para o texto da hora
            encostar no topo do bloco. Itera todas as horas (inclui a última,
            que marca a base da janela). */}
        <div className="relative w-14 shrink-0" style={{ height: gridHeight }}>
          {hours.map((hour) => (
            <span
              key={hour}
              className="absolute right-1 -translate-y-1/2 font-mono text-xs tabular-nums text-muted-foreground"
              style={{ top: (hour - startHour) * HOUR_HEIGHT }}
            >
              {hour.toString().padStart(2, "0")}:00
            </span>
          ))}
        </div>

        {/* Colunas de profissionais. */}
        {columns.map((column, index) => (
          <div
            key={column.professional?.id ?? `outros-${index}`}
            className="relative flex-1 border-l border-border"
            style={{ height: gridHeight, minWidth: singleColumn ? undefined : 120 }}
          >
            {/* Faixa de expediente (comunica "aqui atende"). */}
            {workingWindows.map((window, windowIndex) => {
              const top =
                ((window.start - startMinutes) / 60) * HOUR_HEIGHT;
              const height = ((window.end - window.start) / 60) * HOUR_HEIGHT;
              return (
                <div
                  key={windowIndex}
                  aria-hidden="true"
                  className="absolute inset-x-0 bg-muted/20"
                  style={{ top, height }}
                />
              );
            })}

            {/* Linhas de hora (hairlines). */}
            {hours.slice(0, -1).map((hour) => (
              <div
                key={hour}
                aria-hidden="true"
                className="absolute inset-x-0 border-t border-border/60"
                style={{ top: (hour - startHour) * HOUR_HEIGHT }}
              />
            ))}

            {/* Faixas vazias clicáveis (criar agendamento): uma por hora, cada
                uma alcançável por teclado e rotulada pelo horário. O pointer
                afina o horário pelo offset do clique; o teclado usa o início da
                hora focada. */}
            {onCreateAt
              ? hours.slice(0, -1).map((hour) => {
                  const baseMinutes = hour * 60;
                  return (
                    <button
                      key={`create-${hour}`}
                      type="button"
                      aria-label={`Criar agendamento às ${minutesToHhmm(baseMinutes)}`}
                      className="absolute inset-x-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
                      style={{
                        top: (hour - startHour) * HOUR_HEIGHT,
                        height: HOUR_HEIGHT,
                      }}
                      onClick={(event) => {
                        const rect =
                          event.currentTarget.getBoundingClientRect();
                        const offsetY = event.clientY - rect.top;
                        onCreateAt(
                          column.professional?.id ?? null,
                          timeFromHourOffset(baseMinutes, offsetY),
                        );
                      }}
                    />
                  );
                })
              : null}

            {/* Blocos de agendamento. */}
            {column.appointments.map((appointment) => {
              const start = minutesOfDay(appointment.starts_at, timeZone);
              const end = minutesOfDay(appointment.ends_at, timeZone);
              const top = ((start - startMinutes) / 60) * HOUR_HEIGHT;
              const rawHeight = ((end - start) / 60) * HOUR_HEIGHT;
              const height = Math.max(MIN_BLOCK_HEIGHT, rawHeight);
              return (
                <div
                  key={appointment.id}
                  className="absolute inset-x-1 z-10"
                  style={{ top, height }}
                >
                  <AppointmentBlock
                    appointment={appointment}
                    timeZone={timeZone}
                    compact={rawHeight < HOUR_HEIGHT}
                    onOpen={onOpenAppointment}
                  />
                </div>
              );
            })}

            {/* Linha do "agora" em jade (decoração; horário nunca só por cor). */}
            {nowMinutes != null &&
            nowMinutes >= startMinutes &&
            nowMinutes <= endHour * 60 ? (
              <div
                aria-hidden="true"
                className="absolute inset-x-0 z-20 h-0.5 bg-primary"
                style={{
                  top: ((nowMinutes - startMinutes) / 60) * HOUR_HEIGHT,
                }}
              >
                <span className="absolute -left-1 -top-1 h-2 w-2 rounded-full bg-primary" />
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}
