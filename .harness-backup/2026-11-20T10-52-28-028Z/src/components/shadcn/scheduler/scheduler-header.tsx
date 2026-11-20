"use client"

import { cn } from "@/lib/cn"
import {
  type Professional,
  type SchedulerViewMode,
  formatPriceBRL,
} from "./scheduler-types"
import { Button } from "@/components/shadcn/ui/button"
import { Combobox } from "@/components/shadcn/ui/combobox"
import {
  CalendarDays,
  CalendarRange,
  ListOrdered,
  ChevronLeft,
  ChevronRight,
  Plus,
  Users,
  DollarSign,
} from "lucide-react"

interface SchedulerHeaderProps {
  currentDate: Date
  onDateChange: (date: Date) => void
  viewMode: SchedulerViewMode
  onViewModeChange: (mode: SchedulerViewMode) => void
  professionals: Professional[]
  selectedProfessionalId: string // "all" or specific professional id
  onSelectProfessionalId: (id: string) => void
  onNewAppointment: () => void
  totalAppointments: number
  inProgressCount: number
  totalRevenue: number
}

export function SchedulerHeader({
  currentDate,
  onDateChange,
  viewMode,
  onViewModeChange,
  professionals,
  selectedProfessionalId,
  onSelectProfessionalId,
  onNewAppointment,
  totalAppointments,
  inProgressCount,
  totalRevenue,
}: SchedulerHeaderProps) {
  // Navegação de datas
  const handlePrev = () => {
    const next = new Date(currentDate)
    if (viewMode === "week") {
      next.setDate(next.getDate() - 7)
    } else {
      next.setDate(next.getDate() - 1)
    }
    onDateChange(next)
  }

  const handleNext = () => {
    const next = new Date(currentDate)
    if (viewMode === "week") {
      next.setDate(next.getDate() + 7)
    } else {
      next.setDate(next.getDate() + 1)
    }
    onDateChange(next)
  }

  const handleToday = () => {
    onDateChange(new Date("2026-11-10T12:00:00"))
  }

  // Opções para o Combobox
  const professionalFilterOptions = [
    { value: "all", label: "Todos os Profissionais", description: "Visualizar equipe completa" },
    ...professionals.map((p) => ({
      value: p.id,
      label: p.name,
      description: p.role,
    })),
  ]

  // Formatação de data
  const formattedDate = new Intl.DateTimeFormat("pt-BR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(currentDate)

  const capitalizedDate =
    formattedDate.charAt(0).toUpperCase() + formattedDate.slice(1)

  return (
    <div className="flex flex-col gap-4 border-b border-border/70 pb-4">
      {/* Linha superior: Navegação de datas, Modos de visão e Botão Novo */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        {/* Controles de Data */}
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleToday}
            className="h-8 text-xs font-medium"
          >
            Hoje
          </Button>

          <div className="flex items-center rounded-lg border border-border/80 bg-background shadow-xs">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={handlePrev}
              className="h-8 w-8 rounded-r-none hover:bg-muted"
              title="Anterior"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <div className="h-4 w-px bg-border/60" />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={handleNext}
              className="h-8 w-8 rounded-l-none hover:bg-muted"
              title="Próximo"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>

          <div className="ml-1">
            <h2 className="text-base font-bold tracking-tight text-foreground sm:text-lg">
              {capitalizedDate}
            </h2>
          </div>
        </div>

        {/* Lado direito: Seletor de Modo + Novo Agendamento */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Seletor de visualização (Dia / Semana / Lista) */}
          <div className="flex items-center rounded-lg border border-border/80 bg-muted/30 p-0.5 shadow-xs">
            <button
              type="button"
              onClick={() => onViewModeChange("day")}
              className={cn(
                "flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-all",
                viewMode === "day"
                  ? "bg-background text-foreground shadow-xs font-semibold"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <CalendarDays className="h-3.5 w-3.5" />
              <span>Dia</span>
            </button>

            <button
              type="button"
              onClick={() => onViewModeChange("week")}
              className={cn(
                "flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-all",
                viewMode === "week"
                  ? "bg-background text-foreground shadow-xs font-semibold"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <CalendarRange className="h-3.5 w-3.5" />
              <span>Semana</span>
            </button>

            <button
              type="button"
              onClick={() => onViewModeChange("list")}
              className={cn(
                "flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-all",
                viewMode === "list"
                  ? "bg-background text-foreground shadow-xs font-semibold"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <ListOrdered className="h-3.5 w-3.5" />
              <span>Lista</span>
            </button>
          </div>

          <Button
            type="button"
            onClick={onNewAppointment}
            size="sm"
            className="h-8 gap-1.5 shadow-xs"
          >
            <Plus className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Novo Agendamento</span>
            <span className="sm:hidden">Agendar</span>
          </Button>
        </div>
      </div>

      {/* Linha inferior: Filtro por profissional + Micro-KPIs do Dia */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        {/* Combobox de seleção do profissional */}
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-muted-foreground shrink-0">
            Filtrar:
          </span>
          <Combobox
            items={professionalFilterOptions}
            value={selectedProfessionalId}
            onValueChange={onSelectProfessionalId}
            placeholder="Filtrar por profissional..."
            searchPlaceholder="Buscar médico..."
            emptyText="Nenhum profissional."
            className="w-[260px] h-8 text-xs"
          />
        </div>

        {/* Micro-cards KPI integrados com rim light */}
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {/* Total Agendamentos */}
          <div className="relative flex items-center gap-2 rounded-lg border border-border/70 bg-card px-3 py-1.5 shadow-2xs">
            <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-foreground/10 to-transparent" />
            <Users className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-muted-foreground">Consultas:</span>
            <span className="font-semibold text-foreground font-mono tabular-nums">
              {totalAppointments}
            </span>
          </div>

          {/* Em Atendimento */}
          <div className="relative flex items-center gap-2 rounded-lg border border-border/70 bg-card px-3 py-1.5 shadow-2xs">
            <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-foreground/10 to-transparent" />
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-sky-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-sky-500" />
            </span>
            <span className="text-muted-foreground">Em Atendimento:</span>
            <span className="font-semibold text-foreground font-mono tabular-nums">
              {inProgressCount}
            </span>
          </div>

          {/* Faturamento Previsto */}
          <div className="relative flex items-center gap-2 rounded-lg border border-border/70 bg-card px-3 py-1.5 shadow-2xs">
            <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-foreground/10 to-transparent" />
            <DollarSign className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
            <span className="text-muted-foreground">Previsto:</span>
            <span className="font-semibold text-foreground font-mono tabular-nums">
              {formatPriceBRL(totalRevenue)}
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}
