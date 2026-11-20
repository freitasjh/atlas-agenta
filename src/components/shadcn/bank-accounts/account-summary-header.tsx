import { useState } from "react"
import {
  Landmark,
  ArrowLeftRight,
  Upload,
  RefreshCw,
  TrendingUp,
  Lock,
  ArrowDownLeft,
  ArrowUpRight,
  CheckCircle2,
} from "lucide-react"
import { Button } from "@/components/shadcn/ui/button"
import { Badge } from "@/components/shadcn/ui/badge"
import { cn } from "@/lib/cn"
import {
  BANK_INSTITUTIONS,
  type BankAccount,
  type TreasuryMetrics,
} from "./bank-accounts-types"
import { toast } from "sonner"

interface AccountSummaryHeaderProps {
  account: BankAccount | null
  metrics: TreasuryMetrics
  onOpenTransfer: () => void
  onOpenImportOFX: () => void
  onSyncAccount?: () => void
  className?: string
}

export function AccountSummaryHeader({
  account,
  metrics,
  onOpenTransfer,
  onOpenImportOFX,
  onSyncAccount,
  className,
}: AccountSummaryHeaderProps) {
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
      onSyncAccount?.()
      toast.success(
        account
          ? `Extrato de ${account.nickname} sincronizado via Open Finance!`
          : "Sincronização global do Open Finance concluída!"
      )
    }, 900)
  }

  const currentBalance = account
    ? account.currentBalance
    : metrics.totalConsolidatedBalance

  const currentBlocked = account
    ? account.blockedBalance
    : metrics.totalBlockedBalance

  const institutionInfo = account
    ? BANK_INSTITUTIONS[account.institution]
    : null

  const accountTypeLabel = () => {
    if (!account) return "Visão Consolidada • Todas as Instituições"
    switch (account.type) {
      case "checking":
        return "Conta Corrente PJ"
      case "savings":
        return "Conta Poupança"
      case "investment":
        return "Conta Investimento / Tesouraria CDI"
      case "wallet":
        return "Carteira Digital / Gateway"
      case "physical_cash":
        return "Caixa Físico / Cofre"
    }
  }

  return (
    <div
      className={cn(
        "rounded-2xl border border-border/80 bg-card p-5 sm:p-6 shadow-xs text-card-foreground",
        className
      )}
    >
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-center">
        {/* Coluna 1: Saldo Disponível e Identificação da Conta */}
        <div className="lg:col-span-5 space-y-2">
          <div className="flex items-center gap-2">
            {institutionInfo ? (
              <Badge
                variant="outline"
                className={`text-[11px] font-semibold gap-1 border shadow-2xs ${institutionInfo.lightBg}`}
              >
                <span>{institutionInfo.name}</span>
                {institutionInfo.compe !== "---" && (
                  <span className="opacity-75 font-mono">({institutionInfo.compe})</span>
                )}
              </Badge>
            ) : (
              <Badge
                variant="outline"
                className="border-primary/40 bg-primary/10 text-primary font-semibold gap-1 text-[11px]"
              >
                <Landmark className="h-3 w-3" />
                Tesouraria Consolidada
              </Badge>
            )}

            <span className="text-xs text-muted-foreground font-medium">
              {account ? account.nickname : "Saldo Geral da Empresa"}
            </span>
          </div>

          <div>
            <span className="text-xs text-muted-foreground block font-medium">
              {accountTypeLabel()}
            </span>
            <span className="font-mono text-3xl sm:text-4xl font-extrabold tracking-tight text-foreground block tabular-nums">
              {formatBRL(currentBalance)}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground pt-0.5">
            {account ? (
              <>
                <span className="font-mono">
                  {account.agency !== "---" ? `Ag: ${account.agency} • ` : ""}
                  Cc: {account.accountNumber}-{account.accountDigit}
                </span>
                <span className="flex items-center gap-1">
                  <CheckCircle2 className="h-3 w-3 text-emerald-500" />
                  {account.lastSyncAt}
                </span>
              </>
            ) : (
              <span className="flex items-center gap-1">
                <TrendingUp className="h-3.5 w-3.5 text-emerald-500" />
                Rentabilidade acumulada de <strong className="text-foreground">{formatBRL(metrics.monthYieldCDI)}</strong> (104% CDI)
              </span>
            )}
          </div>
        </div>

        {/* Coluna 2: Mini Bloco de Tesouraria / Projeção */}
        <div className="lg:col-span-4 rounded-xl border border-border/70 bg-muted/30 p-4 space-y-2.5">
          <div className="flex items-center justify-between text-xs">
            <span className="font-semibold text-muted-foreground flex items-center gap-1">
              <TrendingUp className="h-3.5 w-3.5 text-primary" />
              Projeção de Fluxo (15d):
            </span>
            {currentBlocked > 0 && (
              <span className="flex items-center gap-1 text-[11px] text-amber-600 dark:text-amber-400 font-mono">
                <Lock className="h-3 w-3" /> {formatBRL(currentBlocked)} bloqueado
              </span>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="rounded-lg bg-background p-2 border border-border/60">
              <span className="text-[10px] text-muted-foreground flex items-center gap-1 mb-0.5">
                <ArrowDownLeft className="h-3 w-3 text-emerald-600" /> Entradas
              </span>
              <span className="font-mono font-bold text-emerald-600 dark:text-emerald-400 tabular-nums text-xs">
                + {formatBRL(metrics.projectedInflow15Days)}
              </span>
            </div>

            <div className="rounded-lg bg-background p-2 border border-border/60">
              <span className="text-[10px] text-muted-foreground flex items-center gap-1 mb-0.5">
                <ArrowUpRight className="h-3 w-3 text-destructive" /> Saídas
              </span>
              <span className="font-mono font-bold text-foreground tabular-nums text-xs">
                - {formatBRL(metrics.projectedOutflow15Days)}
              </span>
            </div>
          </div>
        </div>

        {/* Coluna 3: Botões de Ação Rápida */}
        <div className="lg:col-span-3 flex flex-col sm:flex-row lg:flex-col justify-center gap-2">
          <Button
            type="button"
            onClick={onOpenTransfer}
            className="h-10 text-xs font-semibold gap-2 shadow-xs bg-emerald-600 hover:bg-emerald-700 text-white"
          >
            <ArrowLeftRight className="h-4 w-4" />
            <span>Transferência Entre Contas</span>
          </Button>

          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onOpenImportOFX}
              className="flex-1 text-xs font-semibold gap-1.5 h-9"
            >
              <Upload className="h-3.5 w-3.5 text-muted-foreground" />
              <span>Importar OFX</span>
            </Button>

            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleSync}
              disabled={isSyncing}
              className="flex-1 text-xs font-semibold gap-1 text-muted-foreground hover:text-foreground h-9"
              title="Sincronizar via Open Finance"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isSyncing ? "animate-spin text-primary" : ""}`} />
              <span>Sync</span>
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

