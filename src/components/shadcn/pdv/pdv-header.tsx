import {
  Store,
  Wifi,
  ShieldCheck,
  Maximize2,
  DollarSign,
  Lock,
  ArrowDownCircle,
  ArrowUpCircle,
  History,
} from "lucide-react"
import { Badge } from "@/components/shadcn/ui/badge"
import { Button } from "@/components/shadcn/ui/button"
import type { RegisterStatus } from "./pdv-types"

interface PDVHeaderProps {
  registerStatus: RegisterStatus
  onOpenCashMovement: (type?: "sangria" | "suprimento") => void
  onCloseRegister: () => void
  onOpenHistory?: () => void
}

export function PDVHeader({
  registerStatus,
  onOpenCashMovement,
  onCloseRegister,
  onOpenHistory,
}: PDVHeaderProps) {
  const formatBRL = (val: number) => {
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL",
    }).format(val)
  }

  const toggleFullScreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {})
    } else {
      document.exitFullscreen().catch(() => {})
    }
  }

  return (
    <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border/80 bg-card px-4 py-2.5 text-card-foreground shadow-2xs">
      {/* Lado Esquerdo: Identificação do PDV e Operador */}
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Store className="h-5 w-5" />
        </div>
        <div>
          <div className="flex items-center gap-2">
            <span className="font-bold text-sm text-foreground">
              PDV Frente de Caixa
            </span>
            <Badge variant="outline" className="font-mono text-[10px] font-semibold border-primary/40 text-primary">
              {registerStatus.registerNumber}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground flex items-center gap-1.5">
            <span>Operador: <strong className="text-foreground">{registerStatus.operatorName}</strong></span>
            <span>•</span>
            <span>Aberto às {registerStatus.openedAt}</span>
          </p>
        </div>
      </div>

      {/* Centro: Status Fiscal e Caixa Atual */}
      <div className="flex items-center gap-3">
        <div className="hidden sm:flex items-center gap-2 rounded-lg border border-border/70 bg-muted/30 px-3 py-1.5 text-xs">
          <DollarSign className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
          <span className="text-muted-foreground">Gaveta:</span>
          <span className="font-mono font-bold text-foreground tabular-nums">
            {formatBRL(registerStatus.currentCashInDrawer)}
          </span>
        </div>

        {/* Status Fiscal NFC-e */}
        <div className="flex items-center gap-1.5">
          {registerStatus.isFiscalConnected ? (
            <Badge
              variant="outline"
              className="border-emerald-500/50 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-semibold gap-1 text-[11px]"
            >
              <ShieldCheck className="h-3 w-3" />
              NFC-e Online
            </Badge>
          ) : (
            <Badge
              variant="outline"
              className="border-amber-500/50 bg-amber-500/10 text-amber-600 dark:text-amber-400 font-semibold gap-1 text-[11px]"
            >
              <Wifi className="h-3 w-3" />
              Contingência Offline
            </Badge>
          )}
        </div>
      </div>

      {/* Lado Direito: Ações Rápidas de Frente de Caixa */}
      <div className="flex items-center gap-1.5">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => onOpenCashMovement("suprimento")}
          className="h-8 text-xs font-semibold gap-1 border-border/80 text-foreground"
          title="Entrada de troco na gaveta"
        >
          <ArrowDownCircle className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
          <span className="hidden md:inline">Suprimento</span>
        </Button>

        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => onOpenCashMovement("sangria")}
          className="h-8 text-xs font-semibold gap-1 border-border/80 text-foreground"
          title="Retirada preventiva de dinheiro"
        >
          <ArrowUpCircle className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
          <span className="hidden md:inline">Sangria</span>
        </Button>

        {onOpenHistory && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onOpenHistory}
            className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground"
            title="Histórico de vendas deste turno"
          >
            <History className="h-4 w-4" />
          </Button>
        )}

        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={toggleFullScreen}
          className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground hidden lg:inline-flex"
          title="Tela Cheia"
        >
          <Maximize2 className="h-4 w-4" />
        </Button>

        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onCloseRegister}
          className="h-8 text-xs font-semibold gap-1.5 border-destructive/40 text-destructive hover:bg-destructive/10"
        >
          <Lock className="h-3.5 w-3.5" />
          <span>Fechar Caixa</span>
        </Button>
      </div>
    </header>
  )
}

