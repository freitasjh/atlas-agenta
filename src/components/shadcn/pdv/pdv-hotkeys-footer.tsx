import { useEffect } from "react"

interface PDVHotkeysFooterProps {
  onSearchProduct?: () => void
  onAddCustomer?: () => void
  onApplyDiscount?: () => void
  onCashMovement?: () => void
  onCancelLastItem?: () => void
  onClearCart?: () => void
  onFinalizeSale?: () => void
  canFinalize?: boolean
}

export function PDVHotkeysFooter({
  onSearchProduct,
  onAddCustomer,
  onApplyDiscount,
  onCashMovement,
  onCancelLastItem,
  onClearCart,
  onFinalizeSale,
  canFinalize = false,
}: PDVHotkeysFooterProps) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignora se estiver digitando em um input de texto ou textarea
      const target = e.target as HTMLElement
      const isInput =
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable

      // Se o foco estiver em um input de texto, não dispara atalhos alfanuméricos exceto F1..F12
      if (isInput && !e.key.startsWith("F")) {
        return
      }

      if (e.key === "F2") {
        e.preventDefault()
        onSearchProduct?.()
      } else if (e.key === "F3") {
        e.preventDefault()
        onAddCustomer?.()
      } else if (e.key === "F4") {
        e.preventDefault()
        onApplyDiscount?.()
      } else if (e.key === "F7") {
        e.preventDefault()
        onCashMovement?.()
      } else if (e.key === "F8") {
        e.preventDefault()
        onCancelLastItem?.()
      } else if (e.key === "F9") {
        e.preventDefault()
        onClearCart?.()
      } else if (e.key === "F12") {
        e.preventDefault()
        if (canFinalize) {
          onFinalizeSale?.()
        }
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [
    onSearchProduct,
    onAddCustomer,
    onApplyDiscount,
    onCashMovement,
    onCancelLastItem,
    onClearCart,
    onFinalizeSale,
    canFinalize,
  ])

  return (
    <footer className="sticky bottom-0 z-20 flex items-center justify-between gap-2 border-t border-border/80 bg-card/95 px-3 sm:px-4 py-2 text-xs backdrop-blur-md shadow-xs">
      <div className="flex items-center gap-1.5 sm:gap-2 overflow-x-auto pb-0.5 sm:pb-0 scrollbar-none flex-1 min-w-0">
        <button
          type="button"
          onClick={onSearchProduct}
          className="inline-flex items-center gap-1 rounded-md border border-border/80 bg-muted/50 px-2 py-1 font-medium text-foreground hover:bg-muted active:scale-95 transition-all"
        >
          <kbd className="rounded bg-background px-1.5 py-0.5 font-mono text-[10px] font-bold text-foreground shadow-xs">
            F2
          </kbd>
          <span className="hidden sm:inline">Buscar</span> Produto
        </button>

        <button
          type="button"
          onClick={onAddCustomer}
          className="inline-flex items-center gap-1 rounded-md border border-border/80 bg-muted/50 px-2 py-1 font-medium text-foreground hover:bg-muted active:scale-95 transition-all"
        >
          <kbd className="rounded bg-background px-1.5 py-0.5 font-mono text-[10px] font-bold text-foreground shadow-xs">
            F3
          </kbd>
          CPF na Nota
        </button>

        <button
          type="button"
          onClick={onApplyDiscount}
          className="inline-flex items-center gap-1 rounded-md border border-border/80 bg-muted/50 px-2 py-1 font-medium text-foreground hover:bg-muted active:scale-95 transition-all"
        >
          <kbd className="rounded bg-background px-1.5 py-0.5 font-mono text-[10px] font-bold text-foreground shadow-xs">
            F4
          </kbd>
          Desconto
        </button>

        <button
          type="button"
          onClick={onCashMovement}
          className="inline-flex items-center gap-1 rounded-md border border-border/80 bg-muted/50 px-2 py-1 font-medium text-foreground hover:bg-muted active:scale-95 transition-all"
        >
          <kbd className="rounded bg-background px-1.5 py-0.5 font-mono text-[10px] font-bold text-foreground shadow-xs">
            F7
          </kbd>
          Sangria/Suprimento
        </button>

        <button
          type="button"
          onClick={onCancelLastItem}
          className="inline-flex items-center gap-1 rounded-md border border-border/80 bg-muted/50 px-2 py-1 font-medium text-foreground hover:bg-muted active:scale-95 transition-all"
        >
          <kbd className="rounded bg-background px-1.5 py-0.5 font-mono text-[10px] font-bold text-foreground shadow-xs">
            F8
          </kbd>
          Cancelar Item
        </button>

        <button
          type="button"
          onClick={onClearCart}
          className="hidden md:inline-flex items-center gap-1 rounded-md border border-destructive/30 bg-destructive/10 px-2 py-1 font-medium text-destructive hover:bg-destructive/20 active:scale-95 transition-all"
        >
          <kbd className="rounded bg-background px-1.5 py-0.5 font-mono text-[10px] font-bold text-destructive shadow-xs">
            F9
          </kbd>
          Limpar Venda
        </button>
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={!canFinalize}
          onClick={onFinalizeSale}
          className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 font-semibold text-xs transition-all shadow-xs ${
            canFinalize
              ? "bg-emerald-600 hover:bg-emerald-700 text-white active:scale-95 cursor-pointer"
              : "bg-muted text-muted-foreground opacity-50 cursor-not-allowed"
          }`}
        >
          <kbd className="rounded bg-emerald-800/80 px-1.5 py-0.5 font-mono text-[10px] font-bold text-white shadow-xs">
            F12
          </kbd>
          <span>Finalizar Venda</span>
        </button>
      </div>
    </footer>
  )
}
