import { useState } from "react"
import { 
  MapPin, 
  CreditCard, 
  QrCode, 
  Barcode, 
  Edit3, 
  ArrowLeft, 
  ShieldCheck, 
  PackageCheck,
  Lock
} from "lucide-react"
import { Button } from "../ui/button"
import { Badge } from "../ui/badge"
import { Separator } from "../ui/separator"
import { Checkbox } from "../ui/checkbox"
import { Label } from "../ui/label"
import { 
  type ShippingAddress, 
  type PaymentDetails, 
  type OrderItem, 
  formatCurrencyBRL 
} from "./checkout-types"

interface ReviewOrderProps {
  address: ShippingAddress
  payment: PaymentDetails
  items: OrderItem[]
  totalAmount: number
  onBack: () => void
  onEditAddress: () => void
  onEditPayment: () => void
  onConfirmOrder: () => void
  isSubmitting?: boolean
}

export function ReviewOrder({
  address,
  payment,
  items,
  totalAmount,
  onBack,
  onEditAddress,
  onEditPayment,
  onConfirmOrder,
  isSubmitting = false,
}: ReviewOrderProps) {
  const [agreedTerms, setAgreedTerms] = useState(true)

  // Mascaramento de cartão de crédito para exibição segura
  const formatMaskedCard = (cardNum?: string) => {
    if (!cardNum) return "•••• •••• •••• 4242"
    const cleaned = cardNum.replace(/\s+/g, "")
    const last4 = cleaned.slice(-4) || "4242"
    return `•••• •••• •••• ${last4}`
  }

  return (
    <div className="space-y-6">
      {/* Cabeçalho da seção */}
      <div className="space-y-1">
        <h2 className="text-xl font-semibold tracking-tight text-foreground">
          Revisão do Pedido
        </h2>
        <p className="text-sm text-muted-foreground">
          Por favor, confira os dados de entrega, forma de pagamento e os itens antes de confirmar.
        </p>
      </div>

      {/* Grid de Resumo: Endereço e Pagamento */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Card: Endereço de Entrega */}
        <div className="rounded-lg border border-border bg-card p-5 space-y-3.5 relative">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-foreground font-medium text-sm">
              <MapPin className="h-4 w-4 text-primary" />
              <span>Endereço de Entrega / Faturamento</span>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onEditAddress}
              className="h-8 px-2.5 text-xs text-muted-foreground hover:text-foreground gap-1.5"
            >
              <Edit3 className="h-3.5 w-3.5" />
              Editar
            </Button>
          </div>

          <Separator />

          <div className="text-xs text-muted-foreground space-y-1">
            <p className="font-medium text-foreground text-sm">{address.fullName || "Cliente Não Identificado"}</p>
            <p>
              {address.street || "Av. Paulista"}, {address.number || "1000"}
              {address.complement ? ` - ${address.complement}` : ""}
            </p>
            <p>
              {address.neighborhood || "Bela Vista"} • {address.city || "São Paulo"} - {address.state || "SP"}
            </p>
            <p className="font-mono text-muted-foreground">CEP: {address.cep || "01310-100"}</p>
            <div className="pt-1.5 text-muted-foreground border-t border-border/50 flex flex-col gap-0.5">
              <span>E-mail: <strong className="text-foreground font-normal">{address.email || "contato@empresa.com.br"}</strong></span>
              <span>Telefone: <strong className="text-foreground font-normal">{address.phone || "(11) 98765-4321"}</strong></span>
            </div>
          </div>
        </div>

        {/* Card: Forma de Pagamento */}
        <div className="rounded-lg border border-border bg-card p-5 space-y-3.5 relative">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-foreground font-medium text-sm">
              {payment.method === "credit_card" && <CreditCard className="h-4 w-4 text-primary" />}
              {payment.method === "pix" && <QrCode className="h-4 w-4 text-emerald-500" />}
              {payment.method === "boleto" && <Barcode className="h-4 w-4 text-amber-500" />}
              <span>Método de Pagamento</span>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onEditPayment}
              className="h-8 px-2.5 text-xs text-muted-foreground hover:text-foreground gap-1.5"
            >
              <Edit3 className="h-3.5 w-3.5" />
              Editar
            </Button>
          </div>

          <Separator />

          <div className="text-xs text-muted-foreground space-y-2">
            {payment.method === "credit_card" && (
              <>
                <div className="flex items-center justify-between">
                  <span className="font-medium text-foreground text-sm">Cartão de Crédito</span>
                  <Badge variant="outline" className="text-[11px] font-mono">
                    {payment.installments ? `${payment.installments}x` : "1x à vista"}
                  </Badge>
                </div>
                <p className="font-mono tracking-wider text-foreground text-sm">
                  {formatMaskedCard(payment.cardNumber)}
                </p>
                <div className="flex items-center justify-between text-muted-foreground pt-1">
                  <span>Titular: {payment.cardHolder || "NOME NO CARTÃO"}</span>
                  <span>Validade: {payment.cardExpiry || "12/28"}</span>
                </div>
              </>
            )}

            {payment.method === "pix" && (
              <>
                <div className="flex items-center justify-between">
                  <span className="font-medium text-foreground text-sm">Pix Instantâneo</span>
                  <Badge variant="outline" className="text-[11px] bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20">
                    Aprovação em segundos
                  </Badge>
                </div>
                <p className="text-muted-foreground text-xs leading-relaxed">
                  O QR Code e a chave Copia e Cola serão gerados na próxima etapa. Desconto de 5% já aplicado no valor total.
                </p>
              </>
            )}

            {payment.method === "boleto" && (
              <>
                <div className="flex items-center justify-between">
                  <span className="font-medium text-foreground text-sm">Boleto Bancário</span>
                  <Badge variant="outline" className="text-[11px] bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20">
                    Vence em 3 dias
                  </Badge>
                </div>
                <p className="text-muted-foreground text-xs leading-relaxed">
                  O código de barras para pagamento será gerado para impressão ou cópia imediata no internet banking.
                </p>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Itens do Pedido no Review */}
      <div className="rounded-lg border border-border bg-card p-5 space-y-4">
        <div className="flex items-center gap-2 text-foreground font-medium text-sm">
          <PackageCheck className="h-4 w-4 text-primary" />
          <span>Itens Selecionados ({items.length})</span>
        </div>

        <div className="divide-y divide-border">
          {items.map((item) => (
            <div key={item.id} className="py-3 first:pt-0 last:pb-0 flex items-center justify-between gap-4">
              <div className="space-y-0.5">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium text-foreground">{item.name}</p>
                  {item.badge && (
                    <Badge variant="secondary" className="text-[10px] py-0 px-1.5 h-4">
                      {item.badge}
                    </Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground line-clamp-1">{item.description}</p>
                <span className="text-[11px] text-muted-foreground">Qtd: {item.quantity}</span>
              </div>
              <div className="text-right shrink-0">
                <p className="text-sm font-semibold text-foreground">
                  {formatCurrencyBRL(item.price * item.quantity)}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Termos de Aceite e Garantias */}
      <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-3">
        <div className="flex items-start gap-3">
          <Checkbox
            id="terms-conditions"
            checked={agreedTerms}
            onCheckedChange={(checked) => setAgreedTerms(!!checked)}
            className="mt-0.5"
          />
          <div className="space-y-1">
            <Label htmlFor="terms-conditions" className="text-xs text-foreground cursor-pointer font-normal leading-relaxed">
              Li e concordo com os <a href="#terms" className="text-primary hover:underline font-medium">Termos de Serviço</a>, 
              as políticas de renovação e cancelamento e a <a href="#privacy" className="text-primary hover:underline font-medium">Política de Privacidade</a> do Atlas Platform.
            </Label>
          </div>
        </div>

        <div className="pt-2 border-t border-border flex items-center gap-2 text-xs text-muted-foreground">
          <ShieldCheck className="h-4 w-4 text-emerald-500 shrink-0" />
          <span>Garantia de 30 dias para reembolso integral caso não fique satisfeito.</span>
        </div>
      </div>

      {/* Ações / Botões de Navegação */}
      <div className="flex flex-col-reverse sm:flex-row items-center justify-between gap-3 pt-4 border-t border-border">
        <Button
          type="button"
          variant="outline"
          onClick={onBack}
          disabled={isSubmitting}
          className="w-full sm:w-auto gap-2"
        >
          <ArrowLeft className="h-4 w-4" />
          Voltar para Pagamento
        </Button>

        <Button
          type="button"
          onClick={onConfirmOrder}
          disabled={!agreedTerms || isSubmitting}
          className="w-full sm:w-auto min-w-[200px] gap-2 shadow-sm"
        >
          {isSubmitting ? (
            <>Processando Pedido...</>
          ) : (
            <>
              <Lock className="h-4 w-4" />
              Finalizar Compra ({formatCurrencyBRL(totalAmount)})
            </>
          )}
        </Button>
      </div>
    </div>
  )
}
