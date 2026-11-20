"use client"

import { cn } from "@/lib/cn"
import {
  type Professional,
  type Appointment,
  START_HOUR,
  END_HOUR,
  timeToMinutes,
} from "./scheduler-types"
import { AppointmentCard } from "./appointment-card"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/shadcn/ui/avatar"
import { ScrollArea } from "@/components/shadcn/ui/scroll-area"

interface SchedulerDayViewProps {
  professionals: Professional[]
  appointments: Appointment[]
  currentDateString: string // "YYYY-MM-DD"
  selectedAppointmentId?: string
  onSelectAppointment: (appointment: Appointment) => void
  onSlotClick: (professionalId: string, time: string) => void
}

const HOUR_HEIGHT = 80 // pixels per 60 minutes
const HOURS_COUNT = END_HOUR - START_HOUR // 11 hours (08:00 to 19:00)

export function SchedulerDayView({
  professionals,
  appointments,
  currentDateString,
  selectedAppointmentId,
  onSelectAppointment,
  onSlotClick,
}: SchedulerDayViewProps) {
  // Array de horas [8, 9, 10, ... 18]
  const hours = Array.from({ length: HOURS_COUNT }, (_, i) => START_HOUR + i)

  // Indicador de hora atual (Now Indicator): fixado ou baseado em horário de trabalho de demonstração (ex: 10:45)
  const currentDemoMinutes = 10 * 60 + 45 // 10:45
  const nowTop =
    ((currentDemoMinutes - START_HOUR * 60) / 60) * HOUR_HEIGHT

  return (
    <div className="relative flex flex-col rounded-xl border border-border/70 bg-card shadow-xs overflow-hidden">
      {/* Rim light superior */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-foreground/15 to-transparent z-30" />

      <ScrollArea className="w-full">
        <div className="min-w-[850px]">
          {/* HEADER DE PROFISSIONAIS (Sticky top) */}
          <div className="sticky top-0 z-20 flex border-b border-border/80 bg-background/95 backdrop-blur-md">
            {/* Canto superior esquerdo da régua de horas */}
            <div className="w-20 shrink-0 border-r border-border/70 p-3 text-center text-[11px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center justify-center">
              Horário
            </div>

            {/* Colunas dos Profissionais */}
            <div className="flex flex-1 divide-x divide-border/60">
              {professionals.map((prof) => {
                const profAppointments = appointments.filter(
                  (a) =>
                    a.professionalId === prof.id &&
                    a.date === currentDateString &&
                    a.status !== "cancelled"
                )

                const statusColor =
                  prof.status === "available"
                    ? "bg-emerald-500 ring-emerald-500/30"
                    : prof.status === "busy"
                    ? "bg-sky-500 ring-sky-500/30"
                    : "bg-amber-500 ring-amber-500/30"

                return (
                  <div
                    key={prof.id}
                    className="flex-1 p-3 transition-colors hover:bg-muted/30"
                  >
                    <div className="flex items-center gap-2.5">
                      <div className="relative">
                        <Avatar className="h-10 w-10 border border-border/80 shadow-2xs">
                          <AvatarImage src={prof.avatar} alt={prof.name} />
                          <AvatarFallback className="text-xs font-semibold">
                            {prof.initials}
                          </AvatarFallback>
                        </Avatar>
                        {/* Status Dot com anel */}
                        <span
                          className={cn(
                            "absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full ring-2 ring-background",
                            statusColor
                          )}
                        />
                      </div>

                      <div className="flex flex-col overflow-hidden">
                        <span className="truncate text-xs font-bold text-foreground tracking-tight">
                          {prof.name}
                        </span>
                        <span className="truncate text-[11px] text-muted-foreground">
                          {prof.role}
                        </span>
                        <div className="mt-1 flex items-center gap-1 text-[10px]">
                          <span className="inline-flex items-center rounded-md bg-muted px-1.5 py-0.5 font-medium font-mono text-muted-foreground tabular-nums">
                            {profAppointments.length}{" "}
                            {profAppointments.length === 1
                              ? "consulta"
                              : "consultas"}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* CORPO DO GRID / RÉGUA E COLUNAS */}
          <div className="relative flex" style={{ height: `${HOURS_COUNT * HOUR_HEIGHT}px` }}>
            {/* LINHA DE HORA ATUAL (NOW INDICATOR) */}
            {nowTop >= 0 && nowTop <= HOURS_COUNT * HOUR_HEIGHT && (
              <div
                className="pointer-events-none absolute left-0 right-0 z-30 flex items-center"
                style={{ top: `${nowTop}px` }}
              >
                <div className="flex items-center gap-1 bg-rose-500 text-white text-[9px] font-mono font-bold px-1.5 py-0.5 rounded-r shadow-xs">
                  <span className="h-1.5 w-1.5 rounded-full bg-white animate-ping" />
                  10:45
                </div>
                <div className="h-0.5 flex-1 bg-rose-500 shadow-xs" />
              </div>
            )}

            {/* COLUNA ESQUERDA DA RÉGUA DE TEMPO */}
            <div className="w-20 shrink-0 border-r border-border/70 bg-muted/15 select-none">
              {hours.map((hour) => (
                <div
                  key={hour}
                  style={{ height: `${HOUR_HEIGHT}px` }}
                  className="relative border-b border-border/40 px-2 pt-1 text-right"
                >
                  <span className="font-mono text-xs font-medium text-muted-foreground tabular-nums">
                    {hour.toString().padStart(2, "0")}:00
                  </span>
                  {/* Marcador de 30min */}
                  <div className="absolute right-2 top-1/2 -translate-y-1/2 font-mono text-[10px] text-muted-foreground/50 tabular-nums">
                    {hour.toString().padStart(2, "0")}:30
                  </div>
                </div>
              ))}
            </div>

            {/* COLUNAS DOS PROFISSIONAIS */}
            <div className="flex flex-1 divide-x divide-border/60">
              {professionals.map((prof) => {
                const profAppointments = appointments.filter(
                  (a) =>
                    a.professionalId === prof.id &&
                    a.date === currentDateString
                )

                // Intervalo de almoço
                let lunchTop = 0
                let lunchHeight = 0
                if (prof.workHours.lunchStart && prof.workHours.lunchEnd) {
                  const lunchStartMins = timeToMinutes(prof.workHours.lunchStart)
                  const lunchEndMins = timeToMinutes(prof.workHours.lunchEnd)
                  lunchTop =
                    ((lunchStartMins - START_HOUR * 60) / 60) * HOUR_HEIGHT
                  lunchHeight =
                    ((lunchEndMins - lunchStartMins) / 60) * HOUR_HEIGHT
                }

                return (
                  <div
                    key={prof.id}
                    className="relative flex-1 select-none bg-background/50 hover:bg-muted/10 transition-colors"
                  >
                    {/* Linhas de grade horária de fundo */}
                    {hours.map((hour) => (
                      <div
                        key={hour}
                        style={{ height: `${HOUR_HEIGHT}px` }}
                        className="relative border-b border-border/40"
                      >
                        {/* Linha pontilhada de meia hora */}
                        <div className="absolute inset-x-0 top-1/2 border-b border-dashed border-border/25 pointer-events-none" />

                        {/* Slots clicáveis de 30min para agendamento rápido */}
                        <button
                          type="button"
                          onClick={() =>
                            onSlotClick(
                              prof.id,
                              `${hour.toString().padStart(2, "0")}:00`
                            )
                          }
                          className="absolute inset-x-0 top-0 h-1/2 opacity-0 hover:opacity-100 hover:bg-primary/5 transition-opacity cursor-pointer flex items-center justify-center text-[10px] text-primary/70 font-medium"
                        >
                          + Agendar {hour.toString().padStart(2, "0")}:00
                        </button>

                        <button
                          type="button"
                          onClick={() =>
                            onSlotClick(
                              prof.id,
                              `${hour.toString().padStart(2, "0")}:30`
                            )
                          }
                          className="absolute inset-x-0 bottom-0 h-1/2 opacity-0 hover:opacity-100 hover:bg-primary/5 transition-opacity cursor-pointer flex items-center justify-center text-[10px] text-primary/70 font-medium"
                        >
                          + Agendar {hour.toString().padStart(2, "0")}:30
                        </button>
                      </div>
                    ))}

                    {/* BLOCO DE ALMOÇO / INTERVALO (Hachurado) */}
                    {lunchHeight > 0 && (
                      <div
                        style={{
                          top: `${lunchTop}px`,
                          height: `${lunchHeight}px`,
                        }}
                        className="pointer-events-none absolute inset-x-1 rounded-md border border-border/40 bg-muted/40 p-2 flex items-center justify-center"
                      >
                        <span className="text-[10px] font-medium text-muted-foreground/70 uppercase tracking-wider">
                          Intervalo de Almoço
                        </span>
                      </div>
                    )}

                    {/* CARDS DE AGENDAMENTOS */}
                    {profAppointments.map((apt) => (
                      <AppointmentCard
                        key={apt.id}
                        appointment={apt}
                        hourHeight={HOUR_HEIGHT}
                        isSelected={selectedAppointmentId === apt.id}
                        onClick={onSelectAppointment}
                      />
                    ))}
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      </ScrollArea>
    </div>
  )
}
