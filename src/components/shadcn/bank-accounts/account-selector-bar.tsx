import { useRef } from "react"
import { Plus, Star, Landmark, CheckCircle2, ChevronLeft, ChevronRight } from "lucide-react"
import { Button } from "@/components/shadcn/ui/button"
import { cn } from "@/lib/cn"
import {
  BANK_INSTITUTIONS,
  type BankAccount,
} from "./bank-accounts-types"

interface AccountSelectorBarProps {
  accounts: BankAccount[]
  selectedAccountId: string
  totalConsolidatedBalance: number
  onSelectAccount: (accountId: string) => void
  onAddNewAccount: () => void
  className?: string
}

export function AccountSelectorBar({
  accounts,
  selectedAccountId,
  totalConsolidatedBalance,
  onSelectAccount,
  onAddNewAccount,
  className,
}: AccountSelectorBarProps) {
  const scrollRef = useRef<HTMLDivElement>(null)

  const formatBRL = (val: number) => {
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL",
    }).format(val)
  }

  const scrollCarousel = (direction: "left" | "right") => {
    if (scrollRef.current) {
      const scrollAmount = direction === "left" ? -300 : 300
      scrollRef.current.scrollBy({ left: scrollAmount, behavior: "smooth" })
    }
  }

  const isConsolidatedSelected = selectedAccountId === ""

  return (
    <div className={cn("relative flex items-center gap-2 w-full", className)}>
      {/* 1. Botão Fixo de Adicionar Nova Conta (Sempre Visível no Início) */}
      <Button
        type="button"
        size="sm"
        onClick={onAddNewAccount}
        className="h-[52px] px-3.5 text-xs font-semibold gap-2 border border-dashed border-primary/50 bg-primary/5 hover:bg-primary/10 text-primary shrink-0 rounded-xl shadow-2xs transition-all hover:border-primary cursor-pointer"
        title="Adicionar nova conta bancária ou carteira"
      >
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary text-primary-foreground shrink-0 shadow-xs">
          <Plus className="h-4 w-4" />
        </div>
        <span className="hidden sm:inline font-bold">Nova Conta</span>
      </Button>

      {/* Divisor Visual Sutil */}
      <div className="h-8 w-px bg-border/70 shrink-0 hidden sm:block" />

      {/* 2. Chip Fixo / Destacado de Visão Consolidada */}
      <button
        type="button"
        onClick={() => onSelectAccount("")}
        className={cn(
          "flex items-center gap-2.5 px-3.5 py-2 h-[52px] rounded-xl border text-left transition-all shrink-0 cursor-pointer shadow-2xs",
          isConsolidatedSelected
            ? "border-primary bg-primary/10 ring-1 ring-primary/30"
            : "border-border/80 bg-card hover:bg-muted/50 hover:border-border"
        )}
      >
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/15 text-primary shrink-0">
          <Landmark className="h-4 w-4" />
        </div>
        <div className="flex flex-col min-w-0">
          <span className="text-xs font-bold text-foreground leading-tight">
            Visão Consolidada
          </span>
          <span className="font-mono text-xs font-bold text-foreground tabular-nums">
            {formatBRL(totalConsolidatedBalance)}
          </span>
        </div>
      </button>

      {/* 3. Controles de Rolagem do Carrossel (Esquerda/Direita) */}
      <div className="flex items-center gap-1 shrink-0">
        <Button
          type="button"
          variant="outline"
          size="icon"
          onClick={() => scrollCarousel("left")}
          className="h-8 w-8 rounded-lg border-border/80 hover:bg-muted shrink-0 text-muted-foreground hover:text-foreground cursor-pointer shadow-2xs"
          title="Rolar contas para a esquerda"
        >
          <ChevronLeft className="h-4 w-4" />
          <span className="sr-only">Rolar para esquerda</span>
        </Button>
      </div>

      {/* 4. Trilho Rolável das Contas Bancárias (Carrossel) */}
      <div
        ref={scrollRef}
        className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none snap-x flex-1 min-w-0"
        style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
      >
        {accounts.map((acc) => {
          const isSelected = acc.id === selectedAccountId
          const inst = BANK_INSTITUTIONS[acc.institution] || {
            color: "#64748b",
            lightBg: "bg-muted text-muted-foreground",
            iconInitials: "B",
          }

          return (
            <button
              key={acc.id}
              type="button"
              onClick={() => onSelectAccount(acc.id)}
              className={cn(
                "group relative flex items-center gap-2.5 px-3 py-2 h-[52px] rounded-xl border text-left transition-all shrink-0 cursor-pointer shadow-2xs snap-start",
                isSelected
                  ? "border-primary bg-primary/10 ring-1 ring-primary/30"
                  : "border-border/80 bg-card hover:bg-muted/50 hover:border-border"
              )}
            >
              {/* Avatar compacto com as cores do banco */}
              <div
                className={cn(
                  "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg font-bold text-[10px] border shadow-2xs",
                  inst.lightBg
                )}
              >
                {inst.iconInitials}
              </div>

              <div className="flex flex-col min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-bold text-foreground truncate max-w-[130px]">
                    {acc.nickname}
                  </span>
                  {acc.isDefault && (
                    <span title="Conta Principal">
                      <Star className="h-3 w-3 fill-amber-500 text-amber-500 shrink-0" />
                    </span>
                  )}
                  {acc.connectionStatus === "connected" && (
                    <span title="Open Finance Ativo">
                      <CheckCircle2 className="h-3 w-3 text-emerald-500 shrink-0" />
                    </span>
                  )}
                </div>
                <span className="font-mono text-xs font-bold text-foreground tabular-nums">
                  {formatBRL(acc.currentBalance)}
                </span>
              </div>
            </button>
          )
        })}
      </div>

      {/* Botão de Rolagem Direita */}
      <div className="flex items-center shrink-0">
        <Button
          type="button"
          variant="outline"
          size="icon"
          onClick={() => scrollCarousel("right")}
          className="h-8 w-8 rounded-lg border-border/80 hover:bg-muted shrink-0 text-muted-foreground hover:text-foreground cursor-pointer shadow-2xs"
          title="Rolar contas para a direita"
        >
          <ChevronRight className="h-4 w-4" />
          <span className="sr-only">Rolar para direita</span>
        </Button>
      </div>
    </div>
  )
}
