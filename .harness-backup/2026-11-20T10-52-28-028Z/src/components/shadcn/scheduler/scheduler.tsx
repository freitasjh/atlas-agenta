"use client"

import * as React from "react"
import { toast } from "sonner"
import {
  type Professional,
  type Appointment,
  type SchedulerViewMode,
  type AppointmentStatus,
  INITIAL_PROFESSIONALS,
  INITIAL_APPOINTMENTS,
} from "./scheduler-types"
import { SchedulerHeader } from "./scheduler-header"
import { SchedulerDayView } from "./scheduler-day-view"
import { SchedulerWeekView } from "./scheduler-week-view"
import { SchedulerListView } from "./scheduler-list-view"
import { AppointmentDialog } from "./appointment-dialog"
import { AppointmentDetailDialog } from "./appointment-detail-dialog"

interface SchedulerProps {
  initialDate?: Date
  initialViewMode?: SchedulerViewMode
  initialProfessionals?: Professional[]
  initialAppointments?: Appointment[]
  className?: string
}

export function Scheduler({
  initialDate = new Date("2026-11-10T12:00:00"),
  initialViewMode = "day",
  initialProfessionals = INITIAL_PROFESSIONALS,
  initialAppointments = INITIAL_APPOINTMENTS,
  className,
}: SchedulerProps) {
  const [currentDate, setCurrentDate] = React.useState<Date>(initialDate)
  const [viewMode, setViewMode] =
    React.useState<SchedulerViewMode>(initialViewMode)
  const [professionals] =
    React.useState<Professional[]>(initialProfessionals)
  const [appointments, setAppointments] =
    React.useState<Appointment[]>(initialAppointments)
  const [selectedProfessionalId, setSelectedProfessionalId] =
    React.useState<string>("all")

  // Modais de Criação e Detalhes
  const [createDialogOpen, setCreateDialogOpen] = React.useState(false)
  const [detailDialogOpen, setDetailDialogOpen] = React.useState(false)
  const [selectedAppointment, setSelectedAppointment] =
    React.useState<Appointment | null>(null)

  // Dados pré-carregados ao clicar em um slot
  const [slotPrefill, setSlotPrefill] = React.useState<{
    professionalId?: string
    time?: string
    date?: string
  }>({})

  // Formato YYYY-MM-DD da data atual
  const currentDateString = React.useMemo(() => {
    return currentDate.toISOString().split("T")[0] as string
  }, [currentDate])

  // Lista de profissionais a exibir
  const displayedProfessionals = React.useMemo(() => {
    if (selectedProfessionalId === "all") return professionals
    return professionals.filter((p) => p.id === selectedProfessionalId)
  }, [professionals, selectedProfessionalId])

  // Agendamentos ativos da data
  const dayAppointments = React.useMemo(() => {
    return appointments.filter(
      (a) =>
        a.date === currentDateString &&
        (selectedProfessionalId === "all" ||
          a.professionalId === selectedProfessionalId)
    )
  }, [appointments, currentDateString, selectedProfessionalId])

  // Métricas do Dia
  const totalAppointments = dayAppointments.length
  const inProgressCount = dayAppointments.filter(
    (a) => a.status === "in_progress"
  ).length
  const totalRevenue = dayAppointments
    .filter((a) => a.status !== "cancelled")
    .reduce((acc, curr) => acc + curr.price, 0)

  // Handlers
  const handleSlotClick = (
    professionalId: string,
    time: string,
    dateStr?: string
  ) => {
    setSlotPrefill({
      professionalId,
      time,
      date: dateStr || currentDateString,
    })
    setCreateDialogOpen(true)
  }

  const handleSelectAppointment = (appointment: Appointment) => {
    setSelectedAppointment(appointment)
    setDetailDialogOpen(true)
  }

  const handleCreateAppointment = (newApt: Omit<Appointment, "id">) => {
    const id = `apt-${Date.now()}`
    const created: Appointment = {
      ...newApt,
      id,
    }
    setAppointments((prev) => [...prev, created])
    toast.success("Agendamento confirmado!", {
      description: `${created.clientName} às ${created.startTime} (${created.service})`,
    })
  }

  const handleUpdateStatus = (
    appointmentId: string,
    newStatus: AppointmentStatus
  ) => {
    setAppointments((prev) =>
      prev.map((a) => (a.id === appointmentId ? { ...a, status: newStatus } : a))
    )
    if (selectedAppointment && selectedAppointment.id === appointmentId) {
      setSelectedAppointment((prev) =>
        prev ? { ...prev, status: newStatus } : null
      )
    }

    const labels: Record<AppointmentStatus, string> = {
      confirmed: "Confirmado",
      in_progress: "Em Atendimento",
      pending: "Pendente",
      completed: "Concluído",
      cancelled: "Cancelado",
    }
    toast.info(`Status atualizado para: ${labels[newStatus]}`)
  }

  const handleDeleteAppointment = (appointmentId: string) => {
    setAppointments((prev) => prev.filter((a) => a.id !== appointmentId))
    toast.success("Agendamento excluído.")
  }

  const activeProfessionalForDetail = professionals.find(
    (p) => p.id === selectedAppointment?.professionalId
  )

  return (
    <div className={className}>
      <div className="flex flex-col gap-4">
        {/* Barra Superior / Header de Controle */}
        <SchedulerHeader
          currentDate={currentDate}
          onDateChange={setCurrentDate}
          viewMode={viewMode}
          onViewModeChange={setViewMode}
          professionals={professionals}
          selectedProfessionalId={selectedProfessionalId}
          onSelectProfessionalId={setSelectedProfessionalId}
          onNewAppointment={() => {
            setSlotPrefill({
              professionalId:
                selectedProfessionalId !== "all"
                  ? selectedProfessionalId
                  : professionals[0]?.id,
              time: "09:00",
              date: currentDateString,
            })
            setCreateDialogOpen(true)
          }}
          totalAppointments={totalAppointments}
          inProgressCount={inProgressCount}
          totalRevenue={totalRevenue}
        />

        {/* Perspectivas de Visualização */}
        {viewMode === "day" && (
          <SchedulerDayView
            professionals={displayedProfessionals}
            appointments={appointments}
            currentDateString={currentDateString}
            selectedAppointmentId={selectedAppointment?.id}
            onSelectAppointment={handleSelectAppointment}
            onSlotClick={(profId, time) =>
              handleSlotClick(profId, time, currentDateString)
            }
          />
        )}

        {viewMode === "week" && (
          <SchedulerWeekView
            professionals={professionals}
            appointments={appointments}
            currentDate={currentDate}
            selectedProfessionalId={selectedProfessionalId}
            selectedAppointmentId={selectedAppointment?.id}
            onSelectAppointment={handleSelectAppointment}
            onSlotClick={(profId, time, dateStr) =>
              handleSlotClick(profId, time, dateStr)
            }
          />
        )}

        {viewMode === "list" && (
          <SchedulerListView
            professionals={professionals}
            appointments={appointments}
            currentDateString={currentDateString}
            selectedProfessionalId={selectedProfessionalId}
            onSelectAppointment={handleSelectAppointment}
            onUpdateStatus={handleUpdateStatus}
            onNewAppointment={() => {
              setSlotPrefill({
                professionalId: professionals[0]?.id,
                time: "09:00",
                date: currentDateString,
              })
              setCreateDialogOpen(true)
            }}
          />
        )}
      </div>

      {/* Modal de Criação de Agendamento */}
      <AppointmentDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
        professionals={professionals}
        initialProfessionalId={slotPrefill.professionalId}
        initialTime={slotPrefill.time}
        initialDate={slotPrefill.date || currentDateString}
        onSave={handleCreateAppointment}
      />

      {/* Modal de Detalhes e Ações Rápidas */}
      <AppointmentDetailDialog
        open={detailDialogOpen}
        onOpenChange={setDetailDialogOpen}
        appointment={selectedAppointment}
        professional={activeProfessionalForDetail}
        onUpdateStatus={handleUpdateStatus}
        onDelete={handleDeleteAppointment}
      />
    </div>
  )
}

