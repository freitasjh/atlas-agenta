import {
  MoreVertical,
  CheckCircle2,
  RefreshCw,
  AlertCircle,
  Building2,
  Lock,
  ArrowRight,
  Upload,
  ArrowLeftRight,
  ExternalLink,
} from "lucide-react"
import { Badge } from "@/components/shadcn/ui/badge"
import { Button } from "@/components/shadcn/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/shadcn/ui/dropdown-menu"
import {
  BANK_INSTITUTIONS,
  type BankAccount,
} from "./bank-accounts-types"

interface BankAccountCardProps {
  account: BankAccount
  isSelected: boolean
  onSelect: (account: BankAccount) => void
  onTransferFrom?: (account: BankAccount) => void
  onImportOFX?: (account: BankAccount) => void
}

export function BankAccountCard({
  account,
  isSelected,
  onSelect,
  onTransferFrom,
  onImportOFX,
}: BankAccountCardProps) {
  const institution = BANK_INSTITUTIONS[account.institution] || {
    name: account.nickname,
    compe: "---",
    color: "#64748b",
    lightBg: "bg-muted text-muted-foreground",
    iconInitials: "B",
  }

  const formatBRL = (val: number) => {
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL",
    }).format(val)
  }

  const accountTypeLabel = () => {
    switch (account.type) {
      case "checking":
        return "Conta Corrente PJ"
      case "savings":
        return "Poupança"
      case "investment":
        return "Investimento / CDI"
      case "wallet":
        return "Carteira Digital"
      case "physical_cash":
        return "Caixa Físico"
    }
  }

  const connectionBadge = () => {
    switch (account.connectionStatus) {
      case "connected":
        return (
          <Badge
            variant="outline"
            className="border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-[10px] font-semibold gap-1"
          >
            <CheckCircle2 className="h-3 w-3" />
            Open Finance
          </Badge>
        )
      case "syncing":
        return (
          <Badge
            variant="outline"
            className="border-primary/40 bg-primary/10 text-primary text-[10px] font-semibold gap-1"
          >
            <RefreshCw className="h-3 w-3 animate-spin" />
            Sincronizando
          </Badge>
        )
      case "error":
        return (
          <Badge
            variant="outline"
            className="border-destructive/40 bg-destructive/10 text-destructive text-[10px] font-semibold gap-1"
          >
            <AlertCircle className="h-3 w-3" />
            Reconectar
          </Badge>
        )
      case "manual":
        return (
          <Badge
            variant="secondary"
            className="text-[10px] text-muted-foreground font-semibold"
          >
            Manual (OFX)
          </Badge>
        )
    }
  }

  return (
    <div
      onClick={() => onSelect(account)}
      className={`group relative flex flex-col justify-between rounded-2xl border p-4 transition-all cursor-pointer ${
        isSelected
          ? "border-primary bg-card ring-2 ring-primary/20 shadow-sm"
          : "border-border/80 bg-card hover:border-border hover:shadow-xs"
      }`}
    >
      {/* Topo do Card: Ícone do Banco e Apelido */}
      <div>
        <div className="flex items-start justify-between gap-2 mb-3">
          <div className="flex items-center gap-2.5 min-w-0">
            {/* Avatar / Selo da Instituição */}
            <div
              className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl font-bold text-xs tracking-wider border shadow-2xs ${institution.lightBg}`}
            >
              {institution.iconInitials}
            </div>

            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <h3 className="text-xs font-bold text-foreground truncate group-hover:text-primary transition-colors">
                  {account.nickname}
                </h3>
                {account.isDefault && (
                  <Badge
                    variant="secondary"
                    className="text-[9px] px-1.5 py-0 font-semibold bg-primary/10 text-primary border-transparent"
                  >
                    Principal
                  </Badge>
                )}
              </div>
              <p className="text-[11px] text-muted-foreground truncate">
                {institution.name}
              </p>
            </div>
          </div>

          {/* Menu Dropdown de Ações */}
          <div onClick={(e) => e.stopPropagation()}>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
                >
                  <MoreVertical className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48 text-xs">
                <DropdownMenuItem onClick={() => onSelect(account)} className="gap-2">
                  <ExternalLink className="h-3.5 w-3.5 text-primary" />
                  <span>Ver Extrato Completo</span>
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => onTransferFrom?.(account)}
                  className="gap-2"
                >
                  <ArrowLeftRight className="h-3.5 w-3.5 text-muted-foreground" />
                  <span>Transferir desta Conta</span>
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => onImportOFX?.(account)}
                  className="gap-2"
                >
                  <Upload className="h-3.5 w-3.5 text-muted-foreground" />
                  <span>Importar Arquivo OFX</span>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem className="gap-2 text-muted-foreground">
                  <Building2 className="h-3.5 w-3.5" />
                  <span>Configurar Conexão</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {/* Dados da Agência e Conta */}
        <div className="flex items-center justify-between text-[11px] text-muted-foreground font-mono pb-2 border-b border-border/60">
          <span>{accountTypeLabel()}</span>
          <span>
            {account.agency !== "---" && `Ag: ${account.agency} • `}
            Cc: {account.accountNumber}-{account.accountDigit}
          </span>
        </div>
      </div>

      {/* Base do Card: Saldos e Status */}
      <div className="pt-3 space-y-2">
        <div className="flex items-baseline justify-between">
          <span className="text-[11px] text-muted-foreground font-medium">
            Saldo Disponível:
          </span>
          <span className="font-mono text-lg font-extrabold text-foreground tabular-nums">
            {formatBRL(account.currentBalance)}
          </span>
        </div>

        {account.blockedBalance > 0 && (
          <div className="flex items-center justify-between text-[10px] text-amber-600 dark:text-amber-400 font-mono">
            <span className="flex items-center gap-1">
              <Lock className="h-3 w-3" /> Bloqueado:
            </span>
            <span>{formatBRL(account.blockedBalance)}</span>
          </div>
        )}

        <div className="flex items-center justify-between pt-1 border-t border-border/50">
          {connectionBadge()}
          <span className="text-[10px] text-muted-foreground">
            {account.lastSyncAt}
          </span>
        </div>
      </div>

      {isSelected && (
        <div className="absolute -top-1.5 -right-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-xs">
          <ArrowRight className="h-3 w-3" />
        </div>
      )}
    </div>
  )
}

