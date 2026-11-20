import { 
  ShieldCheck, 
  RotateCw, 
  Search
} from "lucide-react"
import { Button } from "../ui/button"
import { Input } from "../ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select"
import { type OperatorStatus } from "./backoffice-types"

interface BackofficeHeaderProps {
  onRefresh: () => void
  isRefreshing?: boolean
  searchQuery: string
  onSearchChange: (q: string) => void
  operatorStatus: OperatorStatus
  onOperatorStatusChange: (status: OperatorStatus) => void
  systemOperational: boolean
}

export function BackofficeHeader({
  onRefresh,
  isRefreshing = false,
  searchQuery,
  onSearchChange,
  operatorStatus,
  onOperatorStatusChange,
  systemOperational = true,
}: BackofficeHeaderProps) {
  return (
    <div className="flex flex-col gap-4 border-b border-border/70 pb-5">
      {/* Linha Superior: Título, Status do Sistema e Status do Operador */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 text-primary font-bold text-xs">
              <ShieldCheck className="h-4 w-4" />
            </span>
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Painel de Operações & Risco
            </span>
          </div>
          <h1 className="text-xl font-bold tracking-tight text-foreground sm:text-2xl">
            Backoffice & Central de Compliance
          </h1>
          <p className="text-xs text-muted-foreground">
            Fila unificada de análise de risco, KYC, prevenção a fraudes e esteira de disputas.
          </p>
        </div>

        {/* Status Pill do Sistema & Operador */}
        <div className="flex flex-wrap items-center gap-3">
          {/* Ticker de Saúde dos Serviços */}
          <div className="flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground shadow-2xs">
            <span className="relative flex h-2 w-2">
              <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${
                systemOperational ? "bg-emerald-400" : "bg-amber-400"
              }`} />
              <span className={`relative inline-flex rounded-full h-2 w-2 ${
                systemOperational ? "bg-emerald-500" : "bg-amber-500"
              }`} />
            </span>
            <span className="text-[11px] font-medium text-foreground">
              {systemOperational ? "Gateways & SPI Operacionais" : "Degradação Parcial"}
            </span>
          </div>

          {/* Seletor de Status do Operador */}
          <div className="w-36">
            <Select
              value={operatorStatus}
              onValueChange={(val) => onOperatorStatusChange(val as OperatorStatus)}
            >
              <SelectTrigger className="h-8 text-xs w-full">
                <SelectValue placeholder="Status do Analista" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="available">
                  <span className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400">
                    <span className="h-2 w-2 rounded-full bg-emerald-500" />
                    Disponível
                  </span>
                </SelectItem>
                <SelectItem value="in_case">
                  <span className="flex items-center gap-1.5 text-blue-600 dark:text-blue-400">
                    <span className="h-2 w-2 rounded-full bg-blue-500" />
                    Em Análise
                  </span>
                </SelectItem>
                <SelectItem value="break">
                  <span className="flex items-center gap-1.5 text-amber-600 dark:text-amber-400">
                    <span className="h-2 w-2 rounded-full bg-amber-500" />
                    Pausa / Almoço
                  </span>
                </SelectItem>
                <SelectItem value="offline">
                  <span className="flex items-center gap-1.5 text-muted-foreground">
                    <span className="h-2 w-2 rounded-full bg-muted-foreground" />
                    Desconectado
                  </span>
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Botão de Atualização Rápida */}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onRefresh}
            disabled={isRefreshing}
            className="h-8 px-2.5 text-xs gap-1.5"
            title="Atualizar fila de casos"
          >
            <RotateCw className={`h-3.5 w-3.5 ${isRefreshing ? "animate-spin text-primary" : ""}`} />
            <span className="hidden sm:inline">Atualizar</span>
          </Button>
        </div>
      </div>

      {/* Linha Inferior: Barra de Busca Global e Filtro Rápido */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-1">
        <div className="relative w-full sm:max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
          <Input
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Buscar por Protocolo (OP-...), CPF/CNPJ, Razão Social ou E-mail..."
            className="pl-8 text-xs h-9 w-full font-mono placeholder:font-sans"
          />
        </div>

        <div className="flex items-center gap-2 self-end sm:self-auto text-[11px] text-muted-foreground">
          <span>Atalho de Busca:</span>
          <kbd className="pointer-events-none inline-flex h-5 select-none items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground opacity-100">
            Ctrl + K
          </kbd>
        </div>
      </div>
    </div>
  )
}
