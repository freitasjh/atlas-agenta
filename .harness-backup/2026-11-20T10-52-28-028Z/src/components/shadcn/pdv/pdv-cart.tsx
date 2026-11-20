import {
  Trash2,
  Plus,
  Minus,
  ShoppingCart,
  UserCheck,
  UserPlus,
  Tag,
  CreditCard,
} from "lucide-react"
import { Button } from "@/components/shadcn/ui/button"
import { Badge } from "@/components/shadcn/ui/badge"
import type { PDVCartItem, PDVCustomer } from "./pdv-types"

interface PDVCartProps {
  saleNumber: string
  items: PDVCartItem[]
  customer: PDVCustomer | null
  globalDiscount: number
  onUpdateQuantity: (itemId: string, newQty: number) => void
  onRemoveItem: (itemId: string) => void
  onClearCart: () => void
  onOpenCustomerModal: () => void
  onOpenDiscountModal: () => void
  onFinalizeSale: () => void
}

export function PDVCart({
  saleNumber,
  items,
  customer,
  globalDiscount,
  onUpdateQuantity,
  onRemoveItem,
  onClearCart,
  onOpenCustomerModal,
  onOpenDiscountModal,
  onFinalizeSale,
}: PDVCartProps) {
  const formatBRL = (val: number) => {
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL",
    }).format(val)
  }

  // Cálculos da Venda
  const subtotal = items.reduce((acc, item) => acc + item.totalAmount, 0)
  const totalDiscount =
    items.reduce((acc, item) => acc + item.discountAmount, 0) + globalDiscount
  const finalTotal = Math.max(0, subtotal - globalDiscount)
  const approxTaxes = finalTotal * 0.18 // Estimativa tributária de 18% (Lei 12.741)
  const totalItemCount = items.reduce((acc, item) => acc + item.quantity, 0)

  return (
    <div className="flex flex-col h-full rounded-2xl border border-border/80 bg-card text-card-foreground shadow-xs overflow-hidden">
      {/* Header da Comanda */}
      <div className="flex items-center justify-between border-b border-border/70 p-3.5 bg-muted/20">
        <div>
          <div className="flex items-center gap-2">
            <ShoppingCart className="h-4 w-4 text-primary" />
            <span className="font-bold text-sm text-foreground">
              Comanda • Cupom {saleNumber}
            </span>
          </div>
          <span className="text-[11px] text-muted-foreground">
            {totalItemCount} {totalItemCount === 1 ? "item" : "itens"} registrados
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          {items.length > 0 && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onClearCart}
              className="h-7 text-[11px] text-destructive hover:bg-destructive/10 px-2"
              title="Cancelar todos os itens da venda [F9]"
            >
              <Trash2 className="h-3 w-3 mr-1" />
              Limpar
            </Button>
          )}
        </div>
      </div>

      {/* Identificação do Consumidor (CPF na Nota) */}
      <div className="flex items-center justify-between px-3.5 py-2 border-b border-border/60 bg-muted/10 text-xs">
        {customer ? (
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <UserCheck className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
            <div className="min-w-0 flex-1">
              <span className="font-semibold text-foreground truncate block text-xs">
                {customer.name || "Consumidor Identificado"}
              </span>
              <span className="font-mono text-[11px] text-muted-foreground">
                CPF: {customer.cpfCnpj}
              </span>
            </div>
            <button
              type="button"
              onClick={onOpenCustomerModal}
              className="text-[11px] text-primary hover:underline shrink-0"
            >
              Alterar
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={onOpenCustomerModal}
            className="flex items-center justify-between w-full text-muted-foreground hover:text-foreground text-xs group"
          >
            <span className="flex items-center gap-1.5">
              <UserPlus className="h-3.5 w-3.5 text-primary" />
              <span>Inserir CPF na Nota [F3]</span>
            </span>
            <Badge variant="outline" className="text-[10px] group-hover:border-primary">
              Não identificado
            </Badge>
          </button>
        )}
      </div>

      {/* Lista de Itens do Cupom */}
      <div className="flex-1 overflow-y-auto divide-y divide-border/60 p-2 space-y-1">
        {items.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 text-center text-muted-foreground p-4">
            <ShoppingCart className="h-8 w-8 text-muted-foreground/40 mb-2" />
            <p className="text-xs font-semibold">Caixa Livre</p>
            <p className="text-[11px]">
              Passe o leitor ou selecione produtos ao lado para iniciar a venda.
            </p>
          </div>
        ) : (
          items.map((item, index) => (
            <div
              key={item.id}
              className="flex items-center justify-between gap-2 p-2 rounded-lg hover:bg-muted/40 transition-colors"
            >
              {/* Sequencial e Descrição */}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="font-mono text-[10px] text-muted-foreground w-4 shrink-0">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <p className="text-xs font-bold text-foreground truncate">
                    {item.name}
                  </p>
                </div>
                <div className="flex items-center gap-2 text-[10px] text-muted-foreground pl-5 font-mono">
                  <span>{item.sku}</span>
                  <span>•</span>
                  <span>{formatBRL(item.unitPrice)} un</span>
                </div>
              </div>

              {/* Controle de Quantidade */}
              <div className="flex items-center gap-1 shrink-0">
                <button
                  type="button"
                  onClick={() => onUpdateQuantity(item.id, item.quantity - 1)}
                  className="flex h-6 w-6 items-center justify-center rounded-md border border-border bg-background text-foreground hover:bg-muted active:scale-95 transition-all"
                  aria-label="Diminuir"
                >
                  <Minus className="h-3 w-3" />
                </button>
                <span className="font-mono text-xs font-bold w-6 text-center tabular-nums">
                  {item.quantity}
                </span>
                <button
                  type="button"
                  onClick={() => onUpdateQuantity(item.id, item.quantity + 1)}
                  className="flex h-6 w-6 items-center justify-center rounded-md border border-border bg-background text-foreground hover:bg-muted active:scale-95 transition-all"
                  aria-label="Aumentar"
                >
                  <Plus className="h-3 w-3" />
                </button>
              </div>

              {/* Total do Item e Remover */}
              <div className="flex items-center gap-2 shrink-0">
                <span className="font-mono text-xs font-bold text-foreground tabular-nums min-w-[70px] text-right">
                  {formatBRL(item.totalAmount)}
                </span>
                <button
                  type="button"
                  onClick={() => onRemoveItem(item.id)}
                  className="text-muted-foreground hover:text-destructive p-1 rounded transition-colors"
                  title="Remover item"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Painel de Totais e Fechamento */}
      <div className="border-t border-border/80 bg-muted/30 p-4 space-y-3">
        {/* Desdobramento Financeiro */}
        <div className="space-y-1.5 text-xs">
          <div className="flex items-center justify-between text-muted-foreground">
            <span>Subtotal:</span>
            <span className="font-mono tabular-nums text-foreground">
              {formatBRL(subtotal)}
            </span>
          </div>

          <div className="flex items-center justify-between text-muted-foreground">
            <button
              type="button"
              onClick={onOpenDiscountModal}
              className="flex items-center gap-1 text-primary hover:underline cursor-pointer"
            >
              <Tag className="h-3 w-3" />
              <span>Descontos [F4]:</span>
            </button>
            <span className="font-mono tabular-nums text-emerald-600 dark:text-emerald-400 font-semibold">
              - {formatBRL(totalDiscount)}
            </span>
          </div>

          <div className="flex items-center justify-between text-[11px] text-muted-foreground/80 pt-0.5">
            <span>Tributos aprox. (18%):</span>
            <span className="font-mono tabular-nums">{formatBRL(approxTaxes)}</span>
          </div>
        </div>

        {/* Total Gigante de Alto Contraste */}
        <div className="rounded-xl border border-border/80 bg-background p-3.5 flex items-center justify-between shadow-xs">
          <div>
            <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider block">
              Total a Pagar
            </span>
            <span className="text-xs text-muted-foreground">
              {totalItemCount} {totalItemCount === 1 ? "item" : "itens"}
            </span>
          </div>
          <span className="font-mono text-3xl font-extrabold tracking-tight text-foreground tabular-nums">
            {formatBRL(finalTotal)}
          </span>
        </div>

        {/* Botão de Finalização F12 */}
        <Button
          type="button"
          disabled={items.length === 0}
          onClick={onFinalizeSale}
          className="w-full h-13 text-sm font-bold gap-2 shadow-sm bg-emerald-600 hover:bg-emerald-700 text-white cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed transition-all"
        >
          <CreditCard className="h-5 w-5" />
          <span>Finalizar Venda • Pagar [F12]</span>
        </Button>
      </div>
    </div>
  )
}

