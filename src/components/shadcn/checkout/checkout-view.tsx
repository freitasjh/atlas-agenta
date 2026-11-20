import { useState } from "react"
import { Lock, ShoppingCart } from "lucide-react"
import { 
  type CheckoutStep, 
  type ShippingAddress, 
  type PaymentDetails, 
  type OrderItem, 
  INITIAL_ORDER_ITEMS 
} from "./checkout-types"
import { CheckoutStepper } from "./checkout-stepper"
import { AddressForm } from "./address-form"
import { PaymentForm } from "./payment-form"
import { ReviewOrder } from "./review-order"
import { OrderSummary } from "./order-summary"
import { OrderSuccess } from "./order-success"

const INITIAL_ADDRESS: ShippingAddress = {
  fullName: "João Carlos Silva",
  email: "joao.silva@empresa.com.br",
  phone: "(11) 98765-4321",
  cep: "01310-100",
  street: "Avenida Paulista",
  number: "1000",
  complement: "Conjunto 1402",
  neighborhood: "Bela Vista",
  city: "São Paulo",
  state: "SP",
  saveAddress: true,
  sameAsBilling: true,
}

const INITIAL_PAYMENT: PaymentDetails = {
  method: "credit_card",
  cardNumber: "4532 •••• •••• 8892",
  cardHolder: "JOAO C SILVA",
  cardExpiry: "08/29",
  cardCvv: "382",
  installments: "3",
  saveCard: true,
}

interface CheckoutViewProps {
  initialItems?: OrderItem[]
  onCompleteOrder?: (orderData: {
    orderNumber: string
    address: ShippingAddress
    payment: PaymentDetails
    items: OrderItem[]
  }) => void
  onNavigateHome?: () => void
}

export function CheckoutView({
  initialItems = INITIAL_ORDER_ITEMS,
  onCompleteOrder,
  onNavigateHome,
}: CheckoutViewProps) {
  const [step, setStep] = useState<CheckoutStep>(1)
  const [address, setAddress] = useState<ShippingAddress>(INITIAL_ADDRESS)
  const [payment, setPayment] = useState<PaymentDetails>(INITIAL_PAYMENT)
  const [items] = useState<OrderItem[]>(initialItems)
  const [appliedCoupon, setAppliedCoupon] = useState<string | undefined>("ATLAS10")
  const [discountPercent, setDiscountPercent] = useState<number>(10)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [generatedOrderNumber, setGeneratedOrderNumber] = useState("")

  // Cupons válidos
  const handleApplyCoupon = (code: string): boolean => {
    if (code === "ATLAS10") {
      setAppliedCoupon("ATLAS10")
      setDiscountPercent(10)
      return true
    }
    if (code === "PROMO20") {
      setAppliedCoupon("PROMO20")
      setDiscountPercent(20)
      return true
    }
    return false
  }

  const handleRemoveCoupon = () => {
    setAppliedCoupon(undefined)
    setDiscountPercent(0)
  }

  // Cálculos de valor
  const subtotal = items.reduce((acc, item) => acc + item.price * item.quantity, 0)
  const couponDiscount = discountPercent > 0 ? (subtotal * discountPercent) / 100 : 0
  const pixDiscount = payment.method === "pix" ? (subtotal - couponDiscount) * 0.05 : 0
  const totalAmount = Math.max(0, subtotal - couponDiscount - pixDiscount)

  // Submissão do endereço (passo 1 -> 2)
  const handleAddressSubmit = (data: ShippingAddress) => {
    setAddress(data)
    setStep(2)
    window.scrollTo({ top: 0, behavior: "smooth" })
  }

  // Submissão do pagamento (passo 2 -> 3)
  const handlePaymentSubmit = (data: PaymentDetails) => {
    setPayment(data)
    setStep(3)
    window.scrollTo({ top: 0, behavior: "smooth" })
  }

  // Confirmação final do pedido (passo 3 -> 4)
  const handleConfirmOrder = () => {
    setIsSubmitting(true)
    setTimeout(() => {
      const orderNum = `#ORD-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`
      setGeneratedOrderNumber(orderNum)
      setIsSubmitting(false)
      setStep(4)
      window.scrollTo({ top: 0, behavior: "smooth" })
      onCompleteOrder?.({
        orderNumber: orderNum,
        address,
        payment,
        items,
      })
    }, 1200)
  }

  // Reiniciar fluxo
  const handleReset = () => {
    setStep(1)
    window.scrollTo({ top: 0, behavior: "smooth" })
  }

  return (
    <div className="min-h-screen bg-background text-foreground py-8 px-4 sm:px-6 lg:px-8">
      <div className="max-w-6xl mx-auto space-y-8">
        {/* Top Header / Brand & Segurança */}
        <header className="flex flex-col sm:flex-row items-center justify-between pb-6 border-b border-border gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-primary-foreground font-bold shadow-sm">
              <ShoppingCart className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight text-foreground">
                Atlas Checkout
              </h1>
              <p className="text-xs text-muted-foreground">
                Ambiente de Pagamento Seguro e Criptografado
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3 text-xs text-muted-foreground bg-muted/40 border border-border px-3.5 py-1.5 rounded-full">
            <Lock className="h-3.5 w-3.5 text-emerald-500" />
            <span>Certificado SSL 256-bit • Dados Protegidos</span>
          </div>
        </header>

        {/* Layout do Checkout */}
        {step < 4 ? (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
            {/* Coluna Principal: Formulários (Passo a Passo) */}
            <main className="lg:col-span-7 xl:col-span-8 space-y-8">
              {/* Stepper de Progresso */}
              <CheckoutStepper currentStep={step} />

              {/* Conteúdo do Passo Ativo */}
              <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
                {step === 1 && (
                  <AddressForm
                    initialData={address}
                    onSubmit={handleAddressSubmit}
                  />
                )}

                {step === 2 && (
                  <PaymentForm
                    initialData={payment}
                    orderTotal={totalAmount}
                    onSubmit={handlePaymentSubmit}
                    onBack={() => setStep(1)}
                  />
                )}

                {step === 3 && (
                  <ReviewOrder
                    address={address}
                    payment={payment}
                    items={items}
                    totalAmount={totalAmount}
                    onBack={() => setStep(2)}
                    onEditAddress={() => setStep(1)}
                    onEditPayment={() => setStep(2)}
                    onConfirmOrder={handleConfirmOrder}
                    isSubmitting={isSubmitting}
                  />
                )}
              </div>
            </main>

            {/* Coluna Lateral: Resumo do Pedido (Sticky) */}
            <aside className="lg:col-span-5 xl:col-span-4 lg:sticky lg:top-8">
              <OrderSummary
                items={items}
                paymentMethod={payment.method}
                appliedCoupon={appliedCoupon}
                discountPercent={discountPercent}
                onApplyCoupon={handleApplyCoupon}
                onRemoveCoupon={handleRemoveCoupon}
              />
            </aside>
          </div>
        ) : (
          /* Tela de Sucesso (Passo 4) */
          <div className="py-6">
            <OrderSuccess
              orderNumber={generatedOrderNumber}
              address={address}
              payment={payment}
              totalAmount={totalAmount}
              onReset={handleReset}
              onTrackOrder={onNavigateHome}
            />
          </div>
        )}
      </div>
    </div>
  )
}
