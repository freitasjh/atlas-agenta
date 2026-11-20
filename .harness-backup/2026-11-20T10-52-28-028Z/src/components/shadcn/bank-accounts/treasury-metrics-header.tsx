import { useState } from "react"
import {
  Wallet,
  ArrowUpRight,
  ArrowDownLeft,
  RefreshCw,
  Plus,
  ArrowLeftRight,
  Upload,
  Lock,
  TrendingUp,
} from "lucide-react"
import { Button } from "@/components/shadcn/ui/button"
import type { TreasuryMetrics } from "./bank-accounts-types"
import { toast } from "sonner"

interface TreasuryMetricsHeaderProps {
  metrics: TreasuryMetrics
  onOpenNewAccount: () => void
  onOpenTransfer: () => void
  onOpenImportOFX: () => void
  onSyncAll?: () => void
}

export function TreasuryMetricsHeader({
  metrics,
  onOpenNewAccount,
  onOpenTransfer,
  onOpenImportOFX,
  onSyncAll,
}: TreasuryMetricsHeaderProps) {
  const [isSyncing, setIsSyncing] = useState(false)

  const formatBRL = (val: number) => {
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL",
    }).format(val)
  }

  const handleSync = () => {
    setIsSyncing(true)
    setTimeout(() => {
      setIsSyncing(false)
      onSyncAll?.()
      toast.success("Todas as contas Open Finance sincronizadas com sucesso!")
    }, 1000)
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Linha Superior: Título da Página e Ações Globais */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-border/70 pb-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-foreground sm:text-2xl flex items-center gap-2">
            <Wallet className="h-6 w-6 text-primary" />
            Contas Bancárias & Tesouraria
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Visão consolidada de caixa, contas correntes, investimentos, carteiras digitais e Open Finance.
          </p>
        </div>

        {/* Grupo de Ações Rápidas */}
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleSync}
            disabled={isSyncing}
            className="h-9 text-xs font-semibold gap-1.5 border-border/80 text-foreground"
            title="Atualizar saldos via Open Finance"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isSyncing ? "animate-spin text-primary" : "text-muted-foreground"}`} />
            <span className="hidden sm:inline">Sincronizar</span> Open Finance
          </Button>

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onOpenImportOFX}
            className="h-9 text-xs font-semibold gap-1.5 border-border/80 text-foreground"
          >
            <Upload className="h-3.5 w-3.5 text-muted-foreground" />
            <span>Importar OFX</span>
          </Button>

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onOpenTransfer}
            className="h-9 text-xs font-semibold gap-1.5 border-border/80 text-foreground"
          >
            <ArrowLeftRight className="h-3.5 w-3.5 text-primary" />
            <span>Transferência</span>
          </Button>

          <Button
            type="button"
            size="sm"
            onClick={onOpenNewAccount}
            className="h-9 text-xs font-bold gap-1.5 bg-primary text-primary-foreground shadow-xs"
          >
            <Plus className="h-4 w-4" />
            <span>Nova Conta</span>
          </Button>
        </div>
      </div>

      {/* Grid de Métricas de Tesouraria ("Verdict Row") */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {/* Card 1: Saldo Consolidado Global */}
        <div className="rounded-2xl border border-border/80 bg-card p-4 shadow-2xs text-card-foreground">
          <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
            <span className="font-medium">Saldo Consolidado Global</span>
            <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
              <TrendingUp className="h-3.5 w-3.5" />
              +8.4% no mês
            </span>
          </div>
          <span className="font-mono text-2xl sm:text-3xl font-extrabold tracking-tight text-foreground block tabular-nums">
            {formatBRL(metrics.totalConsolidatedBalance)}
          </span>
          <div className="flex items-center justify-between text-[11px] text-muted-foreground mt-2 pt-2 border-t border-border/60">
            <span>Disponível: <strong className="text-foreground font-mono">{formatBRL(metrics.totalAvailableBalance)}</strong></span>
            {metrics.totalBlockedBalance > 0 && (
              <span className="flex items-center gap-0.5 text-amber-600 dark:text-amber-400">
                <Lock className="h-3 w-3" />
                Bloqueado: {formatBRL(metrics.totalBlockedBalance)}
              </span>
            )}
          </div>
        </div>

        {/* Card 2: Entradas Previstas (15 dias) */}
        <div className="rounded-2xl border border-border/80 bg-card p-4 shadow-2xs text-card-foreground">
          <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
            <span className="font-medium">Entradas Previstas (15d)</span>
            <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600">
              <ArrowDownLeft className="h-3.5 w-3.5" />
            </div>
          </div>
          <span className="font-mono text-2xl font-extrabold tracking-tight text-emerald-600 dark:text-emerald-400 block tabular-nums">
            + {formatBRL(metrics.projectedInflow15Days)}
          </span>
          <p className="text-[11px] text-muted-foreground mt-2 pt-2 border-t border-border/60">
            Boletos e faturas a vencer de clientes
          </p>
        </div>

        {/* Card 3: Saídas Previstas (15 dias) */}
        <div className="rounded-2xl border border-border/80 bg-card p-4 shadow-2xs text-card-foreground">
          <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
            <span className="font-medium">Saídas Previstas (15d)</span>
            <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-destructive/10 text-destructive">
              <ArrowUpRight className="h-3.5 w-3.5" />
            </div>
          </div>
          <span className="font-mono text-2xl font-extrabold tracking-tight text-foreground block tabular-nums">
            - {formatBRL(metrics.projectedOutflow15Days)}
          </span>
          <p className="text-[11px] text-muted-foreground mt-2 pt-2 border-t border-border/60">
            Fornecedores, impostos e folha programada
          </p>
        </div>

        {/* Card 4: Rendimento de Caixa (CDI) */}
        <div className="rounded-2xl border border-border/80 bg-card p-4 shadow-2xs text-card-foreground">
          <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
            <span className="font-medium">Rentabilidade Acumulada</span>
            <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <TrendingUp className="h-3.5 w-3.5" />
            </div>
          </div>
          <span className="font-mono text-2xl font-extrabold tracking-tight text-foreground block tabular-nums">
            + {formatBRL(metrics.monthYieldCDI)}
          </span>
          <p className="text-[11px] text-muted-foreground mt-2 pt-2 border-t border-border/60">
            104% do CDI nas contas de investimento
          </p>
        </div>
      </div>
    </div>
  )
}

