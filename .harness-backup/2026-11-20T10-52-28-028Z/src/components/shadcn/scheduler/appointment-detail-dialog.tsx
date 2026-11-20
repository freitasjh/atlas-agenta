"use client"

import { cn } from "@/lib/cn"
import {
  type Appointment,
  type Professional,
  type AppointmentStatus,
  STATUS_CONFIG,
  formatPriceBRL,
} from "./scheduler-types"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/shadcn/ui/dialog"
import { Button } from "@/components/shadcn/ui/button"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/shadcn/ui/avatar"
import {
  Clock,
  MapPin,
  Phone,
  Mail,
  User,
  FileText,
  Play,
  CheckCircle2,
  XCircle,
  Trash2,
} from "lucide-react"

interface AppointmentDetailDialogProps {
  appointment: Appointment | null
  professional?: Professional
  open: boolean
  onOpenChange: (open: boolean) => void
  onUpdateStatus: (appointmentId: string, newStatus: AppointmentStatus) => void
  onDelete: (appointmentId: string) => void
}

export function AppointmentDetailDialog({
  appointment,
  professional,
  open,
  onOpenChange,
  onUpdateStatus,
  onDelete,
}: AppointmentDetailDialogProps) {
  if (!appointment) return null

  const statusInfo = STATUS_CONFIG[appointment.status]

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <div className="flex items-center justify-between pr-6">
            <span
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium border",
                statusInfo.bgLight,
                statusInfo.borderColor,
                statusInfo.textColor
              )}
            >
              <span
                className={cn("h-2 w-2 rounded-full", statusInfo.dotColor)}
              />
              {statusInfo.label}
            </span>

            <span className="font-mono text-xs font-semibold text-foreground tabular-nums">
              {formatPriceBRL(appointment.price)}
            </span>
          </div>

          <DialogTitle className="text-lg font-bold mt-2 text-foreground">
            {appointment.service}
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground flex items-center gap-1.5">
            <Clock className="h-3.5 w-3.5 text-muted-foreground" />
            <span>
              {appointment.date} • {appointment.startTime} às {appointment.endTime}
            </span>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2 text-sm">
          {/* Dados do Paciente / Cliente */}
          <div className="rounded-xl border border-border/70 bg-muted/20 p-3 space-y-2">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <User className="h-4 w-4" />
              </div>
              <div>
                <p className="text-xs font-medium text-muted-foreground">Paciente / Cliente</p>
                <p className="font-semibold text-foreground text-sm">{appointment.clientName}</p>
              </div>
            </div>

            {(appointment.clientPhone || appointment.clientEmail) && (
              <div className="flex flex-wrap gap-3 pt-1 border-t border-border/50 text-xs text-muted-foreground">
                {appointment.clientPhone && (
                  <span className="flex items-center gap-1">
                    <Phone className="h-3 w-3 text-muted-foreground" />
                    {appointment.clientPhone}
                  </span>
                )}
                {appointment.clientEmail && (
                  <span className="flex items-center gap-1">
                    <Mail className="h-3 w-3 text-muted-foreground" />
                    {appointment.clientEmail}
                  </span>
                )}
              </div>
            )}
          </div>

          {/* Profissional Responsável */}
          {professional && (
            <div className="flex items-center justify-between rounded-xl border border-border/70 bg-card p-3">
              <div className="flex items-center gap-3">
                <Avatar className="h-9 w-9 border border-border/80">
                  <AvatarImage src={professional.avatar} alt={professional.name} />
                  <AvatarFallback>{professional.initials}</AvatarFallback>
                </Avatar>
                <div>
                  <p className="text-xs font-medium text-muted-foreground">Profissional</p>
                  <p className="font-semibold text-foreground text-sm">{professional.name}</p>
                  <p className="text-[11px] text-muted-foreground">{professional.role}</p>
                </div>
              </div>
              {appointment.room && (
                <div className="text-right">
                  <p className="text-[10px] text-muted-foreground flex items-center gap-1 justify-end">
                    <MapPin className="h-3 w-3" /> Local
                  </p>
                  <p className="text-xs font-medium text-foreground">{appointment.room}</p>
                </div>
              )}
            </div>
          )}

          {/* Observações / Prontuário */}
          {appointment.notes && (
            <div className="rounded-xl border border-border/70 bg-card p-3">
              <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground mb-1">
                <FileText className="h-3.5 w-3.5" />
                <span>Observações & Instruções</span>
              </div>
              <p className="text-xs text-foreground/80 leading-relaxed">
                {appointment.notes}
              </p>
            </div>
          )}

          {/* Ações Rápidas de Status */}
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground">Alterar Status:</p>
            <div className="grid grid-cols-3 gap-2">
              <Button
                type="button"
                variant={appointment.status === "in_progress" ? "default" : "outline"}
                size="sm"
                className="text-xs gap-1 h-8"
                onClick={() => onUpdateStatus(appointment.id, "in_progress")}
              >
                <Play className="h-3 w-3 text-sky-500" />
                Iniciar
              </Button>
              <Button
                type="button"
                variant={appointment.status === "completed" ? "default" : "outline"}
                size="sm"
                className="text-xs gap-1 h-8"
                onClick={() => onUpdateStatus(appointment.id, "completed")}
              >
                <CheckCircle2 className="h-3 w-3 text-emerald-500" />
                Concluir
              </Button>
              <Button
                type="button"
                variant={appointment.status === "cancelled" ? "default" : "outline"}
                size="sm"
                className="text-xs gap-1 h-8 text-rose-600 dark:text-rose-400"
                onClick={() => onUpdateStatus(appointment.id, "cancelled")}
              >
                <XCircle className="h-3 w-3" />
                Cancelar
              </Button>
            </div>
          </div>
        </div>

        <DialogFooter className="flex items-center justify-between border-t border-border/70 pt-3">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-xs text-rose-500 hover:text-rose-600 hover:bg-rose-500/10 gap-1.5"
            onClick={() => {
              onDelete(appointment.id)
              onOpenChange(false)
            }}
          >
            <Trash2 className="h-3.5 w-3.5" />
            Excluir Agendamento
          </Button>

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
          >
            Fechar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
