"use client"

import * as React from "react"
import {
  type Professional,
  type Appointment,
  type AppointmentStatus,
  timeToMinutes,
  minutesToTime,
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
import { Input } from "@/components/shadcn/ui/input"
import { Label } from "@/components/shadcn/ui/label"
import { Combobox } from "@/components/shadcn/ui/combobox"
import {
  Calendar as CalendarIcon,
  Clock,
  User,
  DollarSign,
  MapPin,
  FileText,
  Sparkles,
} from "lucide-react"

interface AppointmentDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  professionals: Professional[]
  initialProfessionalId?: string
  initialTime?: string
  initialDate?: string
  onSave: (newApt: Omit<Appointment, "id">) => void
}

export function AppointmentDialog({
  open,
  onOpenChange,
  professionals,
  initialProfessionalId,
  initialTime = "09:00",
  initialDate = "2026-11-10",
  onSave,
}: AppointmentDialogProps) {
  const [professionalId, setProfessionalId] = React.useState<string>(
    initialProfessionalId || professionals[0]?.id || ""
  )
  const [clientName, setClientName] = React.useState("")
  const [clientPhone, setClientPhone] = React.useState("")
  const [clientEmail, setClientEmail] = React.useState("")
  const [service, setService] = React.useState("")
  const [date, setDate] = React.useState(initialDate)
  const [startTime, setStartTime] = React.useState(initialTime)
  const [endTime, setEndTime] = React.useState(() => {
    const mins = timeToMinutes(initialTime)
    return minutesToTime(mins + 60)
  })
  const [price, setPrice] = React.useState("350")
  const [room, setRoom] = React.useState("Consultório 101")
  const [notes, setNotes] = React.useState("")
  const [status] = React.useState<AppointmentStatus>("confirmed")

  // Atualizar quando props mudarem
  React.useEffect(() => {
    if (initialProfessionalId) {
      setProfessionalId(initialProfessionalId)
    }
  }, [initialProfessionalId])

  React.useEffect(() => {
    if (initialTime) {
      setStartTime(initialTime)
      const mins = timeToMinutes(initialTime)
      setEndTime(minutesToTime(mins + 60))
    }
  }, [initialTime])

  React.useEffect(() => {
    if (initialDate) {
      setDate(initialDate)
    }
  }, [initialDate])

  const professionalOptions = professionals.map((p) => ({
    value: p.id,
    label: p.name,
    description: p.role,
  }))

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!clientName.trim() || !service.trim() || !professionalId) return

    onSave({
      professionalId,
      clientName: clientName.trim(),
      clientPhone: clientPhone.trim() || undefined,
      clientEmail: clientEmail.trim() || undefined,
      service: service.trim(),
      date,
      startTime,
      endTime,
      status,
      price: Number(price) || 0,
      room: room.trim() || undefined,
      notes: notes.trim() || undefined,
    })

    // Reset básico
    setClientName("")
    setClientPhone("")
    setClientEmail("")
    setService("")
    setNotes("")
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <div className="flex items-center gap-2 text-primary">
            <Sparkles className="h-4 w-4" />
            <span className="text-xs font-semibold uppercase tracking-wider">
              Agenda Profissional
            </span>
          </div>
          <DialogTitle className="text-lg font-bold text-foreground">
            Novo Agendamento
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            Reserve um horário na grade do profissional com dados do paciente e procedimento.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 py-2">
          {/* Profissional com Combobox shadcn oficial */}
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-foreground">
              Profissional Responsável *
            </Label>
            <Combobox
              items={professionalOptions}
              value={professionalId}
              onValueChange={setProfessionalId}
              placeholder="Selecione o profissional..."
              searchPlaceholder="Buscar médico ou especialista..."
              emptyText="Nenhum profissional encontrado."
              className="w-full"
            />
          </div>

          {/* Dados do Paciente */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="clientName" className="text-xs font-medium text-foreground">
                Nome do Paciente / Cliente *
              </Label>
              <div className="relative">
                <User className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  id="clientName"
                  value={clientName}
                  onChange={(e) => setClientName(e.target.value)}
                  placeholder="Ex: Ana Clara Santos"
                  className="pl-9 h-9 text-xs"
                  required
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="service" className="text-xs font-medium text-foreground">
                Serviço / Procedimento *
              </Label>
              <Input
                id="service"
                value={service}
                onChange={(e) => setService(e.target.value)}
                placeholder="Ex: Consulta Cardiológica"
                className="h-9 text-xs"
                required
              />
            </div>
          </div>

          {/* Contato do Paciente */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="clientPhone" className="text-xs font-medium text-foreground">
                Telefone / WhatsApp
              </Label>
              <Input
                id="clientPhone"
                value={clientPhone}
                onChange={(e) => setClientPhone(e.target.value)}
                placeholder="(11) 98765-4321"
                className="h-9 text-xs font-mono"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="clientEmail" className="text-xs font-medium text-foreground">
                E-mail (opcional)
              </Label>
              <Input
                id="clientEmail"
                type="email"
                value={clientEmail}
                onChange={(e) => setClientEmail(e.target.value)}
                placeholder="paciente@exemplo.com"
                className="h-9 text-xs"
              />
            </div>
          </div>

          {/* Horários e Data */}
          <div className="grid grid-cols-3 gap-2">
            <div className="space-y-1.5">
              <Label htmlFor="aptDate" className="text-xs font-medium text-foreground">
                Data
              </Label>
              <div className="relative">
                <CalendarIcon className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  id="aptDate"
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="pl-8 h-9 text-xs font-mono"
                  required
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="startTime" className="text-xs font-medium text-foreground">
                Início
              </Label>
              <div className="relative">
                <Clock className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  id="startTime"
                  type="time"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                  className="pl-8 h-9 text-xs font-mono"
                  required
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="endTime" className="text-xs font-medium text-foreground">
                Término
              </Label>
              <div className="relative">
                <Clock className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  id="endTime"
                  type="time"
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                  className="pl-8 h-9 text-xs font-mono"
                  required
                />
              </div>
            </div>
          </div>

          {/* Valor e Local */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="price" className="text-xs font-medium text-foreground">
                Valor Cobrado (R$)
              </Label>
              <div className="relative">
                <DollarSign className="absolute left-2.5 top-2.5 h-4 w-4 text-emerald-600" />
                <Input
                  id="price"
                  type="number"
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  placeholder="350"
                  className="pl-9 h-9 text-xs font-mono tabular-nums"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="room" className="text-xs font-medium text-foreground">
                Sala / Local de Atendimento
              </Label>
              <div className="relative">
                <MapPin className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  id="room"
                  value={room}
                  onChange={(e) => setRoom(e.target.value)}
                  placeholder="Consultório 101"
                  className="pl-9 h-9 text-xs"
                />
              </div>
            </div>
          </div>

          {/* Observações */}
          <div className="space-y-1.5">
            <Label htmlFor="notes" className="text-xs font-medium text-foreground">
              Observações Médicas ou Recomendações
            </Label>
            <div className="relative">
              <FileText className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                id="notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Ex: Primeira consulta, trazer exames anteriores..."
                className="pl-9 h-9 text-xs"
              />
            </div>
          </div>

          <DialogFooter className="gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onOpenChange(false)}
            >
              Cancelar
            </Button>
            <Button type="submit" size="sm" className="gap-1.5">
              Confirmar Agendamento
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
