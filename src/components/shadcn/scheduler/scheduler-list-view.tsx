"use client"

import { cn } from "@/lib/cn"
import {
  type Professional,
  type Appointment,
  type AppointmentStatus,
  STATUS_CONFIG,
  formatPriceBRL,
  timeToMinutes,
} from "./scheduler-types"
import { Button } from "@/components/shadcn/ui/button"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/shadcn/ui/avatar"
import {
  Clock,
  MapPin,
  DollarSign,
  User,
  CalendarX,
  Play,
  CheckCircle2,
} from "lucide-react"

interface SchedulerListViewProps {
  professionals: Professional[]
  appointments: Appointment[]
  currentDateString: string
  selectedProfessionalId: string
  onSelectAppointment: (appointment: Appointment) => void
  onUpdateStatus: (appointmentId: string, status: AppointmentStatus) => void
  onNewAppointment: () => void
}

export function SchedulerListView({
  professionals,
  appointments,
  currentDateString,
  selectedProfessionalId,
  onSelectAppointment,
  onUpdateStatus,
  onNewAppointment,
}: SchedulerListViewProps) {
  // Filtrar agendamentos do dia e profissional
  const filteredAppointments = appointments
    .filter(
      (a) =>
        a.date === currentDateString &&
        (selectedProfessionalId === "all" ||
          a.professionalId === selectedProfessionalId)
    )
    .sort((a, b) => timeToMinutes(a.startTime) - timeToMinutes(b.startTime))

  // Agrupar por turnos: Manhã (<12h), Tarde (12h-18h), Noite (>=18h)
  const morning = filteredAppointments.filter(
    (a) => timeToMinutes(a.startTime) < 12 * 60
  )
  const afternoon = filteredAppointments.filter((a) => {
    const m = timeToMinutes(a.startTime)
    return m >= 12 * 60 && m < 18 * 60
  })
  const evening = filteredAppointments.filter(
    (a) => timeToMinutes(a.startTime) >= 18 * 60
  )

  const renderSection = (title: string, items: Appointment[]) => {
    if (items.length === 0) return null

    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2 border-b border-border/60 pb-1.5">
          <Clock className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {title} ({items.length})
          </h3>
        </div>

        <div className="grid grid-cols-1 gap-2.5">
          {items.map((apt) => {
            const prof = professionals.find((p) => p.id === apt.professionalId)
            const statusInfo = STATUS_CONFIG[apt.status]

            return (
              <div
                key={apt.id}
                className={cn(
                  "group relative flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border border-border/70 bg-card p-3.5 shadow-2xs transition-all hover:border-foreground/30 hover:shadow-xs",
                  apt.status === "cancelled" && "opacity-60"
                )}
              >
                {/* Rim light superior */}
                <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-foreground/15 to-transparent rounded-t-xl" />

                {/* Faixa lateral de status */}
                <div
                  className={cn(
                    "absolute left-0 top-0 bottom-0 w-1 rounded-l-xl",
                    statusInfo.dotColor.split(" ")[0]
                  )}
                />

                {/* Bloco de Horário e Paciente */}
                <div className="flex items-start sm:items-center gap-3 pl-1">
                  {/* Horário badge */}
                  <div className="flex flex-col items-center justify-center rounded-lg border border-border/70 bg-muted/40 px-2.5 py-1.5 font-mono text-xs font-semibold tabular-nums shrink-0">
                    <span className="text-foreground">{apt.startTime}</span>
                    <span className="text-[10px] text-muted-foreground">
                      {apt.endTime}
                    </span>
                  </div>

                  <div className="space-y-0.5">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-sm text-foreground tracking-tight group-hover:text-primary transition-colors">
                        {apt.clientName}
                      </span>
                      <span
                        className={cn(
                          "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium border",
                          statusInfo.bgLight,
                          statusInfo.borderColor,
                          statusInfo.textColor
                        )}
                      >
                        <span
                          className={cn(
                            "h-1.5 w-1.5 rounded-full",
                            statusInfo.dotColor
                          )}
                        />
                        {statusInfo.label}
                      </span>
                    </div>

                    <p className="text-xs text-muted-foreground">
                      {apt.service}
                    </p>

                    <div className="flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground pt-0.5">
                      {apt.room && (
                        <span className="flex items-center gap-1">
                          <MapPin className="h-3 w-3 text-muted-foreground" />
                          {apt.room}
                        </span>
                      )}
                      <span className="flex items-center gap-1 font-mono font-medium text-foreground tabular-nums">
                        <DollarSign className="h-3 w-3 text-emerald-600 dark:text-emerald-400" />
                        {formatPriceBRL(apt.price)}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Bloco do Profissional & Ações Rápidas */}
                <div className="flex items-center justify-between sm:justify-end gap-3 pt-2 sm:pt-0 border-t sm:border-t-0 border-border/40">
                  {prof && (
                    <div className="flex items-center gap-2">
                      <Avatar className="h-7 w-7 border border-border/80">
                        <AvatarImage src={prof.avatar} alt={prof.name} />
                        <AvatarFallback className="text-[10px]">
                          {prof.initials}
                        </AvatarFallback>
                      </Avatar>
                      <div className="text-right">
                        <p className="text-xs font-medium text-foreground leading-none">
                          {prof.name}
                        </p>
                        <p className="text-[10px] text-muted-foreground mt-0.5">
                          {prof.role}
                        </p>
                      </div>
                    </div>
                  )}

                  <div className="flex items-center gap-1.5">
                    {apt.status === "confirmed" && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-7 px-2 text-xs gap-1"
                        onClick={() => onUpdateStatus(apt.id, "in_progress")}
                      >
                        <Play className="h-3 w-3 text-sky-500" />
                        Atender
                      </Button>
                    )}

                    {apt.status === "in_progress" && (
                      <Button
                        type="button"
                        variant="default"
                        size="sm"
                        className="h-7 px-2 text-xs gap-1"
                        onClick={() => onUpdateStatus(apt.id, "completed")}
                      >
                        <CheckCircle2 className="h-3 w-3 text-emerald-400" />
                        Concluir
                      </Button>
                    )}

                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-xs hover:bg-muted"
                      onClick={() => onSelectAppointment(apt)}
                    >
                      Detalhes
                    </Button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  if (filteredAppointments.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border/80 bg-card p-12 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted/60 text-muted-foreground mb-3">
          <CalendarX className="h-6 w-6" />
        </div>
        <h3 className="text-sm font-semibold text-foreground">
          Nenhum agendamento para este dia
        </h3>
        <p className="mt-1 text-xs text-muted-foreground max-w-sm">
          Não há consultas agendadas para a data ou profissional selecionado.
        </p>
        <Button
          type="button"
          onClick={onNewAppointment}
          size="sm"
          className="mt-4 gap-1.5 text-xs"
        >
          <User className="h-3.5 w-3.5" />
          Agendar Primeiro Horário
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {renderSection("Período da Manhã", morning)}
      {renderSection("Período da Tarde", afternoon)}
      {renderSection("Período da Noite", evening)}
    </div>
  )
}
