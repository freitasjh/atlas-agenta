"use client"

import * as React from "react"
import { cn } from "@/lib/cn"
import {
  type Professional,
  type Appointment,
  START_HOUR,
  END_HOUR,
} from "./scheduler-types"
import { AppointmentCard } from "./appointment-card"
import { ScrollArea } from "@/components/shadcn/ui/scroll-area"

interface SchedulerWeekViewProps {
  professionals: Professional[]
  appointments: Appointment[]
  currentDate: Date
  selectedProfessionalId: string
  selectedAppointmentId?: string
  onSelectAppointment: (appointment: Appointment) => void
  onSlotClick: (professionalId: string, time: string, dateStr: string) => void
}

const HOUR_HEIGHT = 76
const HOURS_COUNT = END_HOUR - START_HOUR

export function SchedulerWeekView({
  professionals,
  appointments,
  currentDate,
  selectedProfessionalId,
  selectedAppointmentId,
  onSelectAppointment,
  onSlotClick,
}: SchedulerWeekViewProps) {
  // Encontrar o início da semana (segunda-feira da semana de currentDate)
  const weekDays = React.useMemo(() => {
    const d = new Date(currentDate)
    const day = d.getDay()
    // Ajustar para segunda-feira (se domingo = 0, volta 6 dias; se outro dia volta day - 1)
    const diff = d.getDate() - day + (day === 0 ? -6 : 1)
    const monday = new Date(d.setDate(diff))

    const days = []
    for (let i = 0; i < 6; i++) {
      const current = new Date(monday)
      current.setDate(monday.getDate() + i)
      const dateStr = current.toISOString().split("T")[0] as string

      const dayName = new Intl.DateTimeFormat("pt-BR", {
        weekday: "short",
      }).format(current)
      const dayNum = current.getDate()
      const isToday =
        dateStr === "2026-11-10" ||
        dateStr === new Date().toISOString().split("T")[0]

      days.push({
        date: current,
        dateStr,
        dayName: dayName.toUpperCase().replace(".", ""),
        dayNum,
        isToday,
      })
    }
    return days
  }, [currentDate])

  const hours = Array.from({ length: HOURS_COUNT }, (_, i) => START_HOUR + i)

  // Profissional ativo (se 'all', pega o primeiro ou o selecionado)
  const activeProfessional =
    selectedProfessionalId !== "all"
      ? professionals.find((p) => p.id === selectedProfessionalId) ||
        professionals[0]
      : professionals[0]

  return (
    <div className="relative flex flex-col rounded-xl border border-border/70 bg-card shadow-xs overflow-hidden">
      {/* Rim light superior */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-foreground/15 to-transparent z-30" />

      <ScrollArea className="w-full">
        <div className="min-w-[850px]">
          {/* HEADER DA SEMANA (Sticky top) */}
          <div className="sticky top-0 z-20 flex border-b border-border/80 bg-background/95 backdrop-blur-md">
            <div className="w-20 shrink-0 border-r border-border/70 p-3 text-center text-[11px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center justify-center">
              Horário
            </div>

            <div className="flex flex-1 divide-x divide-border/60">
              {weekDays.map((day) => {
                const dayAppointments = appointments.filter(
                  (a) =>
                    a.date === day.dateStr &&
                    (selectedProfessionalId === "all" ||
                      a.professionalId === activeProfessional?.id) &&
                    a.status !== "cancelled"
                )

                return (
                  <div
                    key={day.dateStr}
                    className={cn(
                      "flex-1 p-3 text-center transition-colors",
                      day.isToday ? "bg-primary/5" : "hover:bg-muted/30"
                    )}
                  >
                    <div className="text-[11px] font-semibold tracking-wider text-muted-foreground">
                      {day.dayName}
                    </div>
                    <div className="mt-1 flex items-center justify-center">
                      <span
                        className={cn(
                          "flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold font-mono",
                          day.isToday
                            ? "bg-primary text-primary-foreground shadow-xs"
                            : "text-foreground"
                        )}
                      >
                        {day.dayNum}
                      </span>
                    </div>
                    <div className="mt-1 text-[10px] text-muted-foreground font-mono">
                      {dayAppointments.length}{" "}
                      {dayAppointments.length === 1 ? "agendado" : "agendados"}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* CORPO DO GRID SEMANAL */}
          <div className="relative flex" style={{ height: `${HOURS_COUNT * HOUR_HEIGHT}px` }}>
            {/* RÉGUA DE TEMPO */}
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
                </div>
              ))}
            </div>

            {/* COLUNAS DOS DIAS */}
            <div className="flex flex-1 divide-x divide-border/60">
              {weekDays.map((day) => {
                const dayAppointments = appointments.filter(
                  (a) =>
                    a.date === day.dateStr &&
                    (selectedProfessionalId === "all" ||
                      a.professionalId === activeProfessional?.id)
                )

                return (
                  <div
                    key={day.dateStr}
                    className={cn(
                      "relative flex-1 select-none transition-colors",
                      day.isToday ? "bg-primary/2" : "bg-background/40 hover:bg-muted/10"
                    )}
                  >
                    {/* Linhas de grade horária */}
                    {hours.map((hour) => (
                      <div
                        key={hour}
                        style={{ height: `${HOUR_HEIGHT}px` }}
                        className="relative border-b border-border/40"
                      >
                        <button
                          type="button"
                          onClick={() =>
                            onSlotClick(
                              activeProfessional?.id || "prof-1",
                              `${hour.toString().padStart(2, "0")}:00`,
                              day.dateStr
                            )
                          }
                          className="absolute inset-x-0 inset-y-0 opacity-0 hover:opacity-100 hover:bg-primary/5 transition-opacity cursor-pointer flex items-center justify-center text-[10px] text-primary/70 font-medium"
                        >
                          + Agendar
                        </button>
                      </div>
                    ))}

                    {/* Cards de agendamento do dia */}
                    {dayAppointments.map((apt) => (
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

