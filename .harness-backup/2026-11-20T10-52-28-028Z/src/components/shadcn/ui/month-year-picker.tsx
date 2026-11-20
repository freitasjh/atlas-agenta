"use client"

import * as React from "react"
import { ChevronLeft, ChevronRight, Calendar as CalendarIcon, Clock } from "lucide-react"
import { Button } from "@/components/shadcn/ui/button"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/shadcn/ui/popover"
import { cn } from "@/lib/cn"

export interface MonthYearValue {
  /** Mês de 1 a 12 (1 = Janeiro, 12 = Dezembro) */
  month: number
  /** Mês indexado em base zero de 0 a 11 (equivalente ao Date.getMonth()) */
  monthIndex: number
  /** Ano com 4 dígitos (ex: 2026) */
  year: number
  /** Objeto Date posicionado no primeiro dia do mês às 00:00:00 */
  date: Date
  /** Rótulo formatado em português (ex: "Novembro de 2026") */
  label: string
  /** Representação ISO do período (ex: "2026-11") */
  isoString: string
}

export type MonthYearInput =
  | Date
  | string // "YYYY-MM" ou "YYYY-MM-DD"
  | { month: number; year: number }
  | { monthIndex: number; year: number }

export interface MonthYearPickerProps {
  /** Valor controlado */
  value?: MonthYearInput
  /** Valor inicial não-controlado */
  defaultValue?: MonthYearInput
  /** Callback acionado ao alterar o mês ou ano */
  onChange?: (value: MonthYearValue) => void
  /** Data mínima permitida */
  minDate?: Date | string
  /** Data máxima permitida */
  maxDate?: Date | string
  /** Formato do texto no botão principal: "long" ("Novembro de 2026") ou "short" ("Nov 2026") */
  format?: "long" | "short"
  /** Habilitar o popover de seleção de mês/ano em grade ao clicar no rótulo */
  allowPicker?: boolean
  /** Tamanho visual do componente */
  size?: "sm" | "default" | "lg"
  /** Desativar o controle */
  disabled?: boolean
  /** Classes CSS adicionais */
  className?: string
  /** Rótulo acessível */
  "aria-label"?: string
}

const MONTH_NAMES_LONG = [
  "Janeiro",
  "Fevereiro",
  "Março",
  "Abril",
  "Maio",
  "Junho",
  "Julho",
  "Agosto",
  "Setembro",
  "Outubro",
  "Novembro",
  "Dezembro",
]

const MONTH_NAMES_SHORT = [
  "Jan",
  "Fev",
  "Mar",
  "Abr",
  "Mai",
  "Jun",
  "Jul",
  "Ago",
  "Set",
  "Out",
  "Nov",
  "Dez",
]

function parseInput(input?: MonthYearInput): { month: number; year: number } {
  if (!input) {
    const now = new Date()
    return { month: now.getMonth() + 1, year: now.getFullYear() }
  }

  if (input instanceof Date) {
    return { month: input.getMonth() + 1, year: input.getFullYear() }
  }

  if (typeof input === "string") {
    const parts = input.split("-")
    if (parts.length >= 2) {
      const y = parseInt(parts[0], 10)
      const m = parseInt(parts[1], 10)
      if (!isNaN(y) && !isNaN(m) && m >= 1 && m <= 12) {
        return { month: m, year: y }
      }
    }
    const d = new Date(input)
    if (!isNaN(d.getTime())) {
      return { month: d.getMonth() + 1, year: d.getFullYear() }
    }
  }

  if (typeof input === "object") {
    if ("month" in input && typeof input.month === "number") {
      return { month: input.month, year: input.year }
    }
    if ("monthIndex" in input && typeof input.monthIndex === "number") {
      return { month: input.monthIndex + 1, year: input.year }
    }
  }

  const now = new Date()
  return { month: now.getMonth() + 1, year: now.getFullYear() }
}

function buildValue(month: number, year: number, format: "long" | "short"): MonthYearValue {
  const monthIndex = month - 1
  const date = new Date(year, monthIndex, 1)
  const monthName = format === "long" ? MONTH_NAMES_LONG[monthIndex] : MONTH_NAMES_SHORT[monthIndex]
  const label = format === "long" ? `${monthName} de ${year}` : `${monthName} ${year}`
  const isoMonth = String(month).padStart(2, "0")
  const isoString = `${year}-${isoMonth}`

  return {
    month,
    monthIndex,
    year,
    date,
    label,
    isoString,
  }
}

/**
 * Componente Seletor e Navegador de Mês e Ano (MonthYearPicker)
 *
 * Exibe um controle compacto em formato de pílula contendo setas para o mês anterior/próximo
 * e o rótulo central (ex: "Novembro de 2026"). Ao clicar no centro, abre uma grade rápida
 * de seleção direta de meses e anos.
 */
export function MonthYearPicker({
  value: controlledValue,
  defaultValue,
  onChange,
  minDate,
  maxDate,
  format = "long",
  allowPicker = true,
  size = "default",
  disabled = false,
  className,
  "aria-label": ariaLabel = "Seletor de Mês e Ano",
}: MonthYearPickerProps) {
  const isControlled = controlledValue !== undefined
  const initial = React.useMemo(
    () => parseInput(controlledValue ?? defaultValue),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  )

  const [internalMonth, setInternalMonth] = React.useState<number>(initial.month)
  const [internalYear, setInternalYear] = React.useState<number>(initial.year)
  const [popoverOpen, setPopoverOpen] = React.useState(false)
  const [pickerViewingYear, setPickerViewingYear] = React.useState<number>(initial.year)

  // Sincroniza se for controlado
  React.useEffect(() => {
    if (controlledValue !== undefined) {
      const parsed = parseInput(controlledValue)
      setInternalMonth(parsed.month)
      setInternalYear(parsed.year)
      setPickerViewingYear(parsed.year)
    }
  }, [controlledValue])

  const currentMonth = isControlled ? parseInput(controlledValue).month : internalMonth
  const currentYear = isControlled ? parseInput(controlledValue).year : internalYear

  const currentValue = React.useMemo(
    () => buildValue(currentMonth, currentYear, format),
    [currentMonth, currentYear, format]
  )

  const parsedMin = React.useMemo(() => (minDate ? parseInput(minDate) : null), [minDate])
  const parsedMax = React.useMemo(() => (maxDate ? parseInput(maxDate) : null), [maxDate])

  const isPrevDisabled = React.useMemo(() => {
    if (disabled) return true
    if (!parsedMin) return false
    const prevYear = currentMonth === 1 ? currentYear - 1 : currentYear
    const prevMonth = currentMonth === 1 ? 12 : currentMonth - 1
    if (prevYear < parsedMin.year) return true
    if (prevYear === parsedMin.year && prevMonth < parsedMin.month) return true
    return false
  }, [disabled, parsedMin, currentMonth, currentYear])

  const isNextDisabled = React.useMemo(() => {
    if (disabled) return true
    if (!parsedMax) return false
    const nextYear = currentMonth === 12 ? currentYear + 1 : currentYear
    const nextMonth = currentMonth === 12 ? 1 : currentMonth + 1
    if (nextYear > parsedMax.year) return true
    if (nextYear === parsedMax.year && nextMonth > parsedMax.month) return true
    return false
  }, [disabled, parsedMax, currentMonth, currentYear])

  const notifyChange = (newMonth: number, newYear: number) => {
    if (!isControlled) {
      setInternalMonth(newMonth)
      setInternalYear(newYear)
    }
    const nextVal = buildValue(newMonth, newYear, format)
    onChange?.(nextVal)
  }

  const handlePrevMonth = (e?: React.MouseEvent) => {
    e?.stopPropagation()
    if (isPrevDisabled) return
    if (currentMonth === 1) {
      notifyChange(12, currentYear - 1)
      setPickerViewingYear(currentYear - 1)
    } else {
      notifyChange(currentMonth - 1, currentYear)
    }
  }

  const handleNextMonth = (e?: React.MouseEvent) => {
    e?.stopPropagation()
    if (isNextDisabled) return
    if (currentMonth === 12) {
      notifyChange(1, currentYear + 1)
      setPickerViewingYear(currentYear + 1)
    } else {
      notifyChange(currentMonth + 1, currentYear)
    }
  }

  const handleSelectMonthGrid = (targetMonthIndex: number) => {
    notifyChange(targetMonthIndex + 1, pickerViewingYear)
    setPopoverOpen(false)
  }

  const handleTodayClick = () => {
    const now = new Date()
    const thisMonth = now.getMonth() + 1
    const thisYear = now.getFullYear()
    setPickerViewingYear(thisYear)
    notifyChange(thisMonth, thisYear)
    setPopoverOpen(false)
  }

  // Estilização de dimensões conforme o tamanho
  const sizeClasses = {
    sm: {
      container: "h-8 rounded-lg text-xs",
      btnChevron: "size-6",
      btnText: "h-7 px-2 text-xs",
      iconSize: "size-3.5",
    },
    default: {
      container: "h-9 sm:h-10 rounded-xl text-sm",
      btnChevron: "size-7 sm:size-8",
      btnText: "h-8 sm:h-9 px-3 text-xs sm:text-sm font-semibold",
      iconSize: "size-4",
    },
    lg: {
      container: "h-11 rounded-2xl text-base",
      btnChevron: "size-9",
      btnText: "h-10 px-4 text-base font-bold",
      iconSize: "size-4.5",
    },
  }[size]

  const triggerButton = (
    <button
      type="button"
      disabled={disabled || !allowPicker}
      className={cn(
        "flex items-center justify-center font-bold tracking-tight text-foreground transition-colors select-none focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 rounded-md",
        sizeClasses.btnText,
        allowPicker && !disabled && "hover:text-primary cursor-pointer",
        disabled && "cursor-not-allowed opacity-50"
      )}
    >
      <span>{currentValue.label}</span>
    </button>
  )

  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={cn(
        "inline-flex items-center justify-between border border-border/80 bg-card p-1 shadow-2xs transition-all",
        sizeClasses.container,
        disabled && "opacity-60 pointer-events-none",
        className
      )}
    >
      {/* Botão Mês Anterior */}
      <Button
        type="button"
        variant="ghost"
        size="icon"
        disabled={isPrevDisabled}
        onClick={handlePrevMonth}
        aria-label="Mês anterior"
        className={cn(
          "shrink-0 rounded-lg text-muted-foreground hover:bg-muted/80 hover:text-foreground transition-all cursor-pointer",
          sizeClasses.btnChevron
        )}
      >
        <ChevronLeft className={sizeClasses.iconSize} />
      </Button>

      {/* Rótulo Central (com Popover de Mês/Ano opcional) */}
      {allowPicker ? (
        <Popover
          open={popoverOpen}
          onOpenChange={(open) => {
            if (!disabled) {
              setPopoverOpen(open)
              if (open) setPickerViewingYear(currentYear)
            }
          }}
        >
          <PopoverTrigger asChild>{triggerButton}</PopoverTrigger>
          <PopoverContent
            align="center"
            sideOffset={8}
            className="w-72 p-3 bg-popover/95 backdrop-blur-sm border-border/80 shadow-lg rounded-2xl"
          >
            {/* Cabeçalho do Seletor: Navegação por Ano */}
            <div className="flex items-center justify-between border-b border-border/70 pb-2.5 mb-3">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => setPickerViewingYear((prev) => prev - 1)}
                className="size-7 rounded-lg text-muted-foreground hover:text-foreground"
                aria-label="Ano anterior"
              >
                <ChevronLeft className="size-4" />
              </Button>

              <div className="flex items-center gap-1.5 font-bold text-sm text-foreground">
                <CalendarIcon className="size-3.5 text-primary" />
                <span>{pickerViewingYear}</span>
              </div>

              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => setPickerViewingYear((prev) => prev + 1)}
                className="size-7 rounded-lg text-muted-foreground hover:text-foreground"
                aria-label="Próximo ano"
              >
                <ChevronRight className="size-4" />
              </Button>
            </div>

            {/* Grade com os 12 Meses */}
            <div className="grid grid-cols-3 gap-1.5">
              {MONTH_NAMES_SHORT.map((shortName, idx) => {
                const isSelected =
                  idx + 1 === currentMonth && pickerViewingYear === currentYear

                const now = new Date()
                const isCurrentCalendarMonth =
                  idx === now.getMonth() && pickerViewingYear === now.getFullYear()

                return (
                  <button
                    key={shortName}
                    type="button"
                    onClick={() => handleSelectMonthGrid(idx)}
                    className={cn(
                      "relative flex h-9 items-center justify-center rounded-xl text-xs font-semibold transition-all cursor-pointer",
                      isSelected
                        ? "bg-primary text-primary-foreground font-bold shadow-xs"
                        : "text-foreground hover:bg-muted/70",
                      isCurrentCalendarMonth &&
                        !isSelected &&
                        "border border-primary/40 font-bold text-primary"
                    )}
                  >
                    <span>{shortName}</span>
                    {isCurrentCalendarMonth && !isSelected && (
                      <span className="absolute bottom-1 size-1 rounded-full bg-primary" />
                    )}
                  </button>
                )
              })}
            </div>

            {/* Rodapé com Atalho de Retorno ao Mês Atual */}
            <div className="mt-3 pt-2.5 border-t border-border/70 flex items-center justify-between gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleTodayClick}
                className="h-7 text-xs font-medium gap-1.5 text-muted-foreground hover:text-foreground w-full justify-center"
              >
                <Clock className="size-3 text-primary" />
                Mês Atual ({MONTH_NAMES_SHORT[new Date().getMonth()]}/{new Date().getFullYear()})
              </Button>
            </div>
          </PopoverContent>
        </Popover>
      ) : (
        triggerButton
      )}

      {/* Botão Próximo Mês */}
      <Button
        type="button"
        variant="ghost"
        size="icon"
        disabled={isNextDisabled}
        onClick={handleNextMonth}
        aria-label="Próximo mês"
        className={cn(
          "shrink-0 rounded-lg text-muted-foreground hover:bg-muted/80 hover:text-foreground transition-all cursor-pointer",
          sizeClasses.btnChevron
        )}
      >
        <ChevronRight className={sizeClasses.iconSize} />
      </Button>
    </div>
  )
}

