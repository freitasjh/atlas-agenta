import { cn } from "@/lib/cn"
import type { CardInvoice } from "./statement-types"

interface InvoiceMonthTabsProps {
  invoices: CardInvoice[]
  selectedInvoiceId: string
  onSelectInvoice: (invoiceId: string) => void
  className?: string
}

export function InvoiceMonthTabs({
  invoices,
  selectedInvoiceId,
  onSelectInvoice,
  className,
}: InvoiceMonthTabsProps) {
  return (
    <div className={cn("flex items-center gap-1.5 border-b border-border/80 pb-3 overflow-x-auto scrollbar-none", className)}>
      {invoices.map((inv) => {
        const isSelected = inv.id === selectedInvoiceId

        return (
          <button
            key={inv.id}
            type="button"
            onClick={() => onSelectInvoice(inv.id)}
            className={cn(
              "px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all shrink-0 cursor-pointer flex items-center gap-2",
              isSelected
                ? "bg-primary text-primary-foreground shadow-xs font-bold"
                : "text-muted-foreground hover:bg-muted/70 hover:text-foreground"
            )}
          >
            <span>{inv.period}</span>

            {/* Micro status dot ou badge */}
            <span
              className={cn(
                "h-1.5 w-1.5 rounded-full",
                inv.status === "paid" && "bg-emerald-400",
                inv.status === "closed" && "bg-amber-400",
                inv.status === "open" && "bg-cyan-400",
                inv.status === "future" && "bg-muted-foreground/50"
              )}
            />
          </button>
        )
      })}
    </div>
  )
}

