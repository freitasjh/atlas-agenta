import { useState } from "react"
import {
  Layers,
  Building2,
  TrendingUp,
  CreditCard,
  Banknote,
  Plus,
} from "lucide-react"
import { BankAccountCard } from "./bank-account-card"
import type { BankAccount, BankAccountType } from "./bank-accounts-types"
import { cn } from "@/lib/cn"

interface BankAccountsGridProps {
  accounts: BankAccount[]
  selectedAccountId: string
  onSelectAccount: (account: BankAccount) => void
  onOpenNewAccount: () => void
  onTransferFrom?: (account: BankAccount) => void
  onImportOFX?: (account: BankAccount) => void
}

type FilterType = "all" | BankAccountType

const FILTER_TABS: { id: FilterType; label: string; icon: typeof Layers }[] = [
  { id: "all", label: "Todas as Contas", icon: Layers },
  { id: "checking", label: "Conta Corrente", icon: Building2 },
  { id: "investment", label: "Investimentos & CDI", icon: TrendingUp },
  { id: "wallet", label: "Carteiras Digitais", icon: CreditCard },
  { id: "physical_cash", label: "Caixa Físico", icon: Banknote },
]

export function BankAccountsGrid({
  accounts,
  selectedAccountId,
  onSelectAccount,
  onOpenNewAccount,
  onTransferFrom,
  onImportOFX,
}: BankAccountsGridProps) {
  const [activeFilter, setActiveFilter] = useState<FilterType>("all")

  const filteredAccounts = accounts.filter((acc) => {
    if (activeFilter === "all") return true
    return acc.type === activeFilter
  })

  return (
    <div className="space-y-3">
      {/* Barra de Filtros de Tipo de Conta */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none">
          {FILTER_TABS.map((tab) => {
            const Icon = tab.icon
            const isSelected = activeFilter === tab.id
            const count =
              tab.id === "all"
                ? accounts.length
                : accounts.filter((a) => a.type === tab.id).length

            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveFilter(tab.id)}
                className={cn(
                  "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold whitespace-nowrap transition-all border",
                  isSelected
                    ? "bg-primary text-primary-foreground border-primary shadow-xs"
                    : "bg-muted/40 text-muted-foreground border-border/70 hover:bg-muted hover:text-foreground"
                )}
              >
                <Icon className="h-3.5 w-3.5 shrink-0" />
                <span>{tab.label}</span>
                <span
                  className={cn(
                    "ml-0.5 rounded-full px-1.5 py-0.2 text-[10px] font-mono",
                    isSelected
                      ? "bg-primary-foreground/20 text-primary-foreground"
                      : "bg-muted text-muted-foreground"
                  )}
                >
                  {count}
                </span>
              </button>
            )
          })}
        </div>

        <span className="text-xs text-muted-foreground self-end sm:self-auto">
          {filteredAccounts.length} {filteredAccounts.length === 1 ? "conta encontrada" : "contas encontradas"}
        </span>
      </div>

      {/* Grid de Cards de Contas */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {filteredAccounts.map((acc) => (
          <BankAccountCard
            key={acc.id}
            account={acc}
            isSelected={acc.id === selectedAccountId}
            onSelect={onSelectAccount}
            onTransferFrom={onTransferFrom}
            onImportOFX={onImportOFX}
          />
        ))}

        {/* Card "+ Cadastrar Nova Conta" */}
        <button
          type="button"
          onClick={onOpenNewAccount}
          className="flex flex-col items-center justify-center min-h-[160px] rounded-2xl border border-dashed border-border/80 bg-muted/20 p-6 text-center hover:bg-muted/40 hover:border-primary/50 transition-all group cursor-pointer"
        >
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary group-hover:bg-primary group-hover:text-primary-foreground transition-all mb-2">
            <Plus className="h-5 w-5" />
          </div>
          <span className="text-xs font-bold text-foreground group-hover:text-primary transition-colors">
            Adicionar Nova Conta
          </span>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            Conecte via Open Finance ou importe via OFX
          </p>
        </button>
      </div>
    </div>
  )
}
