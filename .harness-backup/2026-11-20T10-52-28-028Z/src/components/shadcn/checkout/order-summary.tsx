import { useState, type FormEvent } from "react"
import { 
  ShoppingBag, 
  Tag, 
  Check, 
  X, 
  ShieldCheck, 
  Truck, 
  Headphones,
  ChevronDown,
  ChevronUp
} from "lucide-react"
import { Button } from "../ui/button"
import { Input } from "../ui/input"
import { Badge } from "../ui/badge"
import { Separator } from "../ui/separator"
import { 
  type OrderItem, 
  type PaymentMethodType, 
  formatCurrencyBRL 
} from "./checkout-types"

interface OrderSummaryProps {
  items: OrderItem[]
  paymentMethod: PaymentMethodType
  appliedCoupon?: string
  onApplyCoupon: (couponCode: string) => boolean
  onRemoveCoupon: () => void
  discountPercent?: number
}

export function OrderSummary({
  items,
  paymentMethod,
  appliedCoupon,
  onApplyCoupon,
  onRemoveCoupon,
  discountPercent = 0,
}: OrderSummaryProps) {
  const [couponInput, setCouponInput] = useState("")
  const [couponError, setCouponError] = useState<string | null>(null)
  const [showMobileDetails, setShowMobileDetails] = useState(false)

  // Cálculos financeiros
  const subtotal = items.reduce((acc, item) => acc + item.price * item.quantity, 0)
  
  // Desconto de cupom
  const couponDiscountAmount = discountPercent > 0 ? (subtotal * discountPercent) / 100 : 0
  
  // Desconto Pix de 5%
  const pixDiscountAmount = paymentMethod === "pix" ? (subtotal - couponDiscountAmount) * 0.05 : 0
  
  const totalDiscount = couponDiscountAmount + pixDiscountAmount
  const shipping = 0 // Frete grátis para licenças e produtos digitais
  const total = Math.max(0, subtotal - totalDiscount + shipping)

  const handleApplyCoupon = (e: FormEvent) => {
    e.preventDefault()
    if (!couponInput.trim()) return

    const success = onApplyCoupon(couponInput.trim().toUpperCase())
    if (!success) {
      setCouponError("Cupom inválido ou expirado. Tente 'ATLAS10'.")
    } else {
      setCouponError(null)
      setCouponInput("")
    }
  }

  return (
    <div className="rounded-xl border border-border bg-card p-5 lg:p-6 shadow-sm space-y-6">
      {/* Header do Resumo */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <ShoppingBag className="h-4 w-4" />
          </div>
          <div>
            <h3 className="font-semibold text-base text-foreground">Resumo do Pedido</h3>
            <p className="text-xs text-muted-foreground">{items.length} {items.length === 1 ? "item" : "itens"} no pacote</p>
          </div>
        </div>
        
        {/* Toggle para mobile */}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setShowMobileDetails(!showMobileDetails)}
          className="lg:hidden h-8 px-2 text-xs text-muted-foreground"
        >
          {showMobileDetails ? (
            <>Ocultar <ChevronUp className="h-3.5 w-3.5 ml-1" /></>
          ) : (
            <>Ver itens <ChevronDown className="h-3.5 w-3.5 ml-1" /></>
          )}
        </Button>
      </div>

      {/* Lista de Itens (sempre visível em desktop, colapsável em mobile) */}
      <div className={`space-y-4 ${showMobileDetails ? "block" : "hidden lg:block"}`}>
        <div className="divide-y divide-border">
          {items.map((item) => (
            <div key={item.id} className="py-3.5 first:pt-0 last:pb-0 flex items-start justify-between gap-3">
              <div className="space-y-1 pr-2">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-xs font-semibold text-foreground leading-tight">
                    {item.name}
                  </span>
                  {item.badge && (
                    <Badge variant="secondary" className="text-[10px] py-0 px-1.5 h-4">
                      {item.badge}
                    </Badge>
                  )}
                </div>
                <p className="text-[11px] text-muted-foreground line-clamp-1">{item.description}</p>
                <div className="text-[11px] text-muted-foreground">
                  Qtd: <span className="font-medium text-foreground">{item.quantity}</span>
                </div>
              </div>
              <div className="text-right shrink-0">
                <span className="text-xs font-bold text-foreground">
                  {formatCurrencyBRL(item.price * item.quantity)}
                </span>
              </div>
            </div>
          ))}
        </div>

        <Separator />
      </div>

      {/* Formulário de Cupom de Desconto */}
      <div className="space-y-2">
        <form onSubmit={handleApplyCoupon} className="flex items-center gap-2">
          <div className="relative flex-1">
            <Tag className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
            <Input
              value={couponInput}
              onChange={(e) => {
                setCouponInput(e.target.value)
                if (couponError) setCouponError(null)
              }}
              placeholder="Código de cupom (ex: ATLAS10)"
              className="pl-8 text-xs uppercase h-9"
              disabled={!!appliedCoupon}
            />
          </div>
          <Button
            type="submit"
            variant="secondary"
            size="sm"
            disabled={!couponInput.trim() || !!appliedCoupon}
            className="h-9 px-3 text-xs"
          >
            Aplicar
          </Button>
        </form>

        {couponError && (
          <p className="text-xs text-destructive flex items-center gap-1">
            <X className="h-3 w-3" /> {couponError}
          </p>
        )}

        {/* Tag do cupom ativo */}
        {appliedCoupon && (
          <div className="flex items-center justify-between rounded-md bg-emerald-500/10 border border-emerald-500/20 px-2.5 py-1.5 text-xs text-emerald-700 dark:text-emerald-300">
            <div className="flex items-center gap-1.5">
              <Check className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
              <span>Cupom <strong>{appliedCoupon}</strong> (-{discountPercent}%)</span>
            </div>
            <button
              type="button"
              onClick={onRemoveCoupon}
              className="text-muted-foreground hover:text-foreground text-xs"
              title="Remover cupom"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </div>

      <Separator />

      {/* Discriminação de Valores */}
      <div className="space-y-2.5 text-xs">
        <div className="flex items-center justify-between text-muted-foreground">
          <span>Subtotal</span>
          <span className="font-medium text-foreground">{formatCurrencyBRL(subtotal)}</span>
        </div>

        {couponDiscountAmount > 0 && (
          <div className="flex items-center justify-between text-emerald-600 dark:text-emerald-400">
            <span>Desconto Cupom ({appliedCoupon})</span>
            <span className="font-medium">-{formatCurrencyBRL(couponDiscountAmount)}</span>
          </div>
        )}

        {pixDiscountAmount > 0 && (
          <div className="flex items-center justify-between text-emerald-600 dark:text-emerald-400">
            <span>Desconto Pix (5% off)</span>
            <span className="font-medium">-{formatCurrencyBRL(pixDiscountAmount)}</span>
          </div>
        )}

        <div className="flex items-center justify-between text-muted-foreground">
          <span className="flex items-center gap-1">
            <Truck className="h-3.5 w-3.5 text-primary" />
            Frete / Entrega Digital
          </span>
          <span className="font-medium text-emerald-600 dark:text-emerald-400">GRÁTIS</span>
        </div>

        <div className="flex items-center justify-between text-muted-foreground">
          <span>Impostos e Taxas (NF-e)</span>
          <span className="font-medium text-muted-foreground">Inclusos</span>
        </div>

        <Separator className="my-2" />

        <div className="flex items-center justify-between pt-1">
          <div>
            <span className="text-sm font-bold text-foreground">Total a Pagar</span>
            <p className="text-[11px] text-muted-foreground">
              {paymentMethod === "pix" && "À vista com desconto Pix"}
              {paymentMethod === "credit_card" && "Em até 12x no cartão"}
              {paymentMethod === "boleto" && "À vista via boleto"}
            </p>
          </div>
          <div className="text-right">
            <span className="text-xl font-bold tracking-tight text-foreground">
              {formatCurrencyBRL(total)}
            </span>
          </div>
        </div>
      </div>

      {/* Badges de Confiabilidade & Suporte */}
      <div className="rounded-lg bg-muted/40 p-3.5 space-y-2 text-[11px] text-muted-foreground border border-border/40">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-emerald-500 shrink-0" />
          <span>Transação criptografada com certificado SSL 256-bit</span>
        </div>
        <div className="flex items-center gap-2">
          <Headphones className="h-4 w-4 text-primary shrink-0" />
          <span>Atendimento especializado e suporte humanizado 24/7</span>
        </div>
      </div>
    </div>
  )
}
