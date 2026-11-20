"use client"

import { cn } from "@/lib/cn"
import {
  type Appointment,
  STATUS_CONFIG,
  formatPriceBRL,
  timeToMinutes,
  START_HOUR,
} from "./scheduler-types"
import { Clock, MapPin, DollarSign } from "lucide-react"

interface AppointmentCardProps {
  appointment: Appointment
  hourHeight?: number // default 84px per hour
  onClick?: (appointment: Appointment) => void
  isSelected?: boolean
}

export function AppointmentCard({
  appointment,
  hourHeight = 84,
  onClick,
  isSelected = false,
}: AppointmentCardProps) {
  const statusInfo = STATUS_CONFIG[appointment.status]

  // Cálculo de posição e altura
  const startMins = timeToMinutes(appointment.startTime)
  const endMins = timeToMinutes(appointment.endTime)
  const durationMins = Math.max(endMins - startMins, 20) // mínimo 20 min visual

  const minutesFromStart = Math.max(startMins - START_HOUR * 60, 0)
  const top = (minutesFromStart / 60) * hourHeight
  const height = Math.max((durationMins / 60) * hourHeight - 4, 34) // 4px gap

  const isCompact = height < 50

  return (
    <button
      type="button"
      onClick={() => onClick?.(appointment)}
      style={{
        top: `${top}px`,
        height: `${height}px`,
      }}
      className={cn(
        "group absolute inset-x-1 z-10 flex flex-col justify-between overflow-hidden rounded-lg p-2 text-left transition-all duration-150",
        "border bg-card/95 backdrop-blur-xs shadow-xs hover:shadow-md hover:z-20",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        statusInfo.borderColor,
        isSelected
          ? "ring-2 ring-primary shadow-md border-primary"
          : "hover:border-foreground/30",
        isCompact ? "p-1.5" : "p-2"
      )}
    >
      {/* Rim light superior */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-foreground/20 to-transparent" />

      {/* Faixa lateral esquerda indicando status */}
      <div
        className={cn(
          "absolute left-0 top-0 bottom-0 w-1",
          statusInfo.dotColor.split(" ")[0]
        )}
      />

      <div className="flex flex-col gap-0.5 overflow-hidden pl-1">
        {/* Linha superior: Horário + Status dot */}
        <div className="flex items-center justify-between gap-1 text-[11px] font-medium leading-none text-muted-foreground">
          <span className="flex items-center gap-1 font-mono tabular-nums text-foreground/90">
            <Clock className="h-2.5 w-2.5 text-muted-foreground" />
            {appointment.startTime} - {appointment.endTime}
          </span>
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-full px-1.5 py-0.2 text-[10px] font-medium",
              statusInfo.bgLight,
              statusInfo.textColor
            )}
          >
            <span
              className={cn("h-1.5 w-1.5 rounded-full", statusInfo.dotColor)}
            />
            {!isCompact && <span>{statusInfo.label}</span>}
          </span>
        </div>

        {/* Nome do paciente/cliente */}
        <div className="truncate text-xs font-semibold text-foreground tracking-tight group-hover:text-primary transition-colors">
          {appointment.clientName}
        </div>

        {/* Serviço */}
        {!isCompact && (
          <div className="truncate text-[11px] text-muted-foreground">
            {appointment.service}
          </div>
        )}
      </div>

      {/* Linha inferior (se altura permitir): Sala e Preço */}
      {!isCompact && height >= 70 && (
        <div className="mt-1 flex items-center justify-between border-t border-border/50 pt-1 text-[10px] text-muted-foreground pl-1">
          <span className="flex items-center gap-1 truncate max-w-[110px]">
            {appointment.room && (
              <>
                <MapPin className="h-2.5 w-2.5 shrink-0 text-muted-foreground" />
                <span className="truncate">{appointment.room}</span>
              </>
            )}
          </span>
          <span className="flex items-center gap-0.5 font-mono font-medium text-foreground tabular-nums shrink-0">
            <DollarSign className="h-2.5 w-2.5 text-emerald-600 dark:text-emerald-400" />
            {formatPriceBRL(appointment.price)}
          </span>
        </div>
      )}
    </button>
  )
}
