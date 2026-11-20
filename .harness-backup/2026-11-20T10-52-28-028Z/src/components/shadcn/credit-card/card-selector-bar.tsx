import { useRef } from "react"
import { Plus, Star, CreditCard, ChevronLeft, ChevronRight } from "lucide-react"
import { Button } from "@/components/shadcn/ui/button"
import { cn } from "@/lib/cn"
import type { CardWithInvoices } from "./statement-types"

interface CardSelectorBarProps {
  cards: CardWithInvoices[]
  selectedCardId: string
  totalConsolidatedAmount?: number
  onSelectCard: (cardId: string) => void
  onAddNewCard: () => void
  className?: string
}

export function CardSelectorBar({
  cards,
  selectedCardId,
  totalConsolidatedAmount = 0,
  onSelectCard,
  onAddNewCard,
  className,
}: CardSelectorBarProps) {
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

  const isConsolidatedSelected = selectedCardId === ""

  return (
    <div className={cn("relative flex items-center gap-2 w-full", className)}>
      {/* 1. Botão Fixo de Adicionar Novo Cartão (Sempre Visível no Início) */}
      <Button
        type="button"
        size="sm"
        onClick={onAddNewCard}
        className="h-[52px] px-3.5 text-xs font-semibold gap-2 border border-dashed border-primary/50 bg-primary/5 hover:bg-primary/10 text-primary shrink-0 rounded-xl shadow-2xs transition-all hover:border-primary cursor-pointer"
        title="Adicionar novo cartão corporativo"
      >
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary text-primary-foreground shrink-0 shadow-xs">
          <Plus className="h-4 w-4" />
        </div>
        <span className="hidden sm:inline font-bold">Novo Cartão</span>
      </Button>

      {/* Divisor Visual Sutil */}
      <div className="h-8 w-px bg-border/70 shrink-0 hidden sm:block" />

      {/* 2. Chip Fixo / Destacado de Fatura Consolidada */}
      <button
        type="button"
        onClick={() => onSelectCard("")}
        className={cn(
          "flex items-center gap-2.5 px-3.5 py-2 h-[52px] rounded-xl border text-left transition-all shrink-0 cursor-pointer shadow-2xs",
          isConsolidatedSelected
            ? "border-primary bg-primary/10 ring-1 ring-primary/30"
            : "border-border/80 bg-card hover:bg-muted/50 hover:border-border"
        )}
      >
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/15 text-primary shrink-0">
          <CreditCard className="h-4 w-4" />
        </div>
        <div className="flex flex-col min-w-0">
          <span className="text-xs font-bold text-foreground leading-tight">
            Fatura Consolidada
          </span>
          <span className="font-mono text-xs font-bold text-foreground tabular-nums">
            {formatBRL(totalConsolidatedAmount)}
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
          title="Rolar cartões para a esquerda"
        >
          <ChevronLeft className="h-4 w-4" />
          <span className="sr-only">Rolar para esquerda</span>
        </Button>
      </div>

      {/* 4. Trilho Rolável dos Cartões (Carrossel) */}
      <div
        ref={scrollRef}
        className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none snap-x flex-1 min-w-0"
        style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
      >
        {cards.map((card) => {
          const isSelected = card.id === selectedCardId

          // Valor da fatura atual do cartão (fechada ou aberta)
          const currentInvoice =
            card.invoices.find((inv) => inv.status === "closed" || inv.status === "open") ||
            card.invoices[0]
          const invoiceAmount = currentInvoice?.totalAmount ?? 0

          return (
            <button
              key={card.id}
              type="button"
              onClick={() => onSelectCard(card.id)}
              className={cn(
                "group relative flex items-center gap-2.5 px-3 py-2 h-[52px] rounded-xl border text-left transition-all shrink-0 cursor-pointer shadow-2xs snap-start",
                isSelected
                  ? "border-primary bg-primary/10 ring-1 ring-primary/30"
                  : "border-border/80 bg-card hover:bg-muted/50 hover:border-border"
              )}
            >
              {/* Mini cartão temático estilizado */}
              <div
                className={cn(
                  "flex h-8 w-11 shrink-0 items-center justify-center rounded-lg border border-white/20 font-mono text-[9px] font-bold text-white shadow-2xs",
                  card.theme === "violet" && "bg-gradient-to-br from-purple-800 to-indigo-950",
                  card.theme === "midnight" && "bg-gradient-to-br from-neutral-800 to-neutral-950",
                  card.theme === "emerald" && "bg-gradient-to-br from-emerald-800 to-teal-950",
                  card.theme === "platinum" && "bg-gradient-to-br from-slate-600 to-slate-900",
                  card.theme === "rose_gold" && "bg-gradient-to-br from-rose-700 to-pink-950"
                )}
              >
                ••••
              </div>

              <div className="flex flex-col min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-bold text-foreground truncate max-w-[130px]">
                    {card.nickname}
                  </span>
                  {card.isDefault && (
                    <span title="Cartão Principal">
                      <Star className="h-3 w-3 fill-amber-500 text-amber-500 shrink-0" />
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="font-mono text-xs font-bold text-foreground tabular-nums">
                    {formatBRL(invoiceAmount)}
                  </span>
                  <span className="text-[10px] font-mono text-muted-foreground uppercase">
                    • {card.last4}
                  </span>
                </div>
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
          title="Rolar cartões para a direita"
        >
          <ChevronRight className="h-4 w-4" />
          <span className="sr-only">Rolar para direita</span>
        </Button>
      </div>
    </div>
  )
}
