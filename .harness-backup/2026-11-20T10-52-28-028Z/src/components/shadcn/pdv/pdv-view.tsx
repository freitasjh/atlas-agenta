import { useState, useCallback } from "react"
import { PDVHeader } from "./pdv-header"
import { PDVProductCatalog } from "./pdv-product-catalog"
import { PDVCart } from "./pdv-cart"
import { PDVPaymentModal } from "./pdv-payment-modal"
import { PDVCashMovementModal } from "./pdv-cash-movement-modal"
import { PDVCustomerModal } from "./pdv-customer-modal"
import { PDVCloseRegisterModal } from "./pdv-close-register-modal"
import { PDVReceiptModal } from "./pdv-receipt-modal"
import { PDVHotkeysFooter } from "./pdv-hotkeys-footer"
import {
  MOCK_PDV_PRODUCTS,
  type PDVProduct,
  type PDVCartItem,
  type PDVCustomer,
  type RegisterStatus,
  type CashMovementRecord,
  type PaymentSplit,
  type CashMovementType,
} from "./pdv-types"
import { toast } from "sonner"
import { cn } from "@/lib/cn"

export interface PDVViewProps {
  initialProducts?: PDVProduct[]
}

export function PDVView({ initialProducts = MOCK_PDV_PRODUCTS }: PDVViewProps) {
  // Estado do Caixa
  const [registerStatus, setRegisterStatus] = useState<RegisterStatus>({
    registerNumber: "Caixa 01",
    operatorName: "Carlos Eduardo",
    openedAt: "08:00",
    initialCash: 150.0,
    currentCashInDrawer: 480.5,
    isOnline: true,
    isFiscalConnected: true,
    nfceSeries: "001",
    nextNfceNumber: 4829,
  })

  // Estado da Venda Atual
  const [saleNumber, setSaleNumber] = useState("004829")
  const [cartItems, setCartItems] = useState<PDVCartItem[]>([
    {
      id: "cart-1",
      productId: "prod-1",
      sku: "BEV-001",
      ean: "7894900010015",
      name: "Coca-Cola Original 350ml Lata",
      unitPrice: 6.5,
      quantity: 2,
      unit: "un",
      discountAmount: 0,
      totalAmount: 13.0,
    },
    {
      id: "cart-2",
      productId: "prod-5",
      sku: "FOOD-001",
      ean: "7891000100101",
      name: "Misto Quente Especial no Pão Francês",
      unitPrice: 14.9,
      quantity: 1,
      unit: "un",
      discountAmount: 0,
      totalAmount: 14.9,
    },
  ])
  const [customer, setCustomer] = useState<PDVCustomer | null>({
    cpfCnpj: "123.456.789-00",
    name: "Mariana Alencar",
  })
  const [globalDiscount, setGlobalDiscount] = useState<number>(0)
  const [completedSplits, setCompletedSplits] = useState<PaymentSplit[]>([])

  // Controle de Foco / Atalhos
  const [searchTrigger, setSearchTrigger] = useState<number>(0)

  // Modais
  const [paymentModalOpen, setPaymentModalOpen] = useState(false)
  const [cashMovementModalOpen, setCashMovementModalOpen] = useState(false)
  const [cashMovementType, setCashMovementType] = useState<CashMovementType>("sangria")
  const [customerModalOpen, setCustomerModalOpen] = useState(false)
  const [closeRegisterModalOpen, setCloseRegisterModalOpen] = useState(false)
  const [receiptModalOpen, setReceiptModalOpen] = useState(false)
  const [mobileTab, setMobileTab] = useState<"catalog" | "cart">("catalog")

  // Totais
  const subtotal = cartItems.reduce((acc, item) => acc + item.totalAmount, 0)
  const finalTotal = Math.max(0, subtotal - globalDiscount)

  // Adicionar Produto ao Carrinho
  const handleSelectProduct = useCallback((product: PDVProduct) => {
    setCartItems((prev) => {
      const existing = prev.find((it) => it.productId === product.id)
      if (existing) {
        return prev.map((it) =>
          it.productId === product.id
            ? {
                ...it,
                quantity: it.quantity + 1,
                totalAmount: (it.quantity + 1) * it.unitPrice,
              }
            : it
        )
      }

      const newItem: PDVCartItem = {
        id: `cart-${Date.now()}-${Math.random()}`,
        productId: product.id,
        sku: product.sku,
        ean: product.ean,
        name: product.name,
        unitPrice: product.price,
        quantity: 1,
        unit: product.unit,
        discountAmount: 0,
        totalAmount: product.price,
      }
      return [...prev, newItem]
    })
    toast.success(`${product.name} adicionado à comanda!`)
  }, [])

  // Atualizar Quantidade
  const handleUpdateQuantity = useCallback((itemId: string, newQty: number) => {
    if (newQty <= 0) {
      setCartItems((prev) => prev.filter((it) => it.id !== itemId))
      return
    }

    setCartItems((prev) =>
      prev.map((it) =>
        it.id === itemId
          ? {
              ...it,
              quantity: newQty,
              totalAmount: newQty * it.unitPrice - it.discountAmount,
            }
          : it
      )
    )
  }, [])

  // Remover Item
  const handleRemoveItem = useCallback((itemId: string) => {
    setCartItems((prev) => prev.filter((it) => it.id !== itemId))
    toast.info("Item cancelado da comanda.")
  }, [])

  // Cancelar Último Item (Atalho F8)
  const handleCancelLastItem = useCallback(() => {
    if (cartItems.length === 0) return
    const lastItem = cartItems[cartItems.length - 1]
    if (lastItem) {
      handleRemoveItem(lastItem.id)
    }
  }, [cartItems, handleRemoveItem])

  // Limpar Carrinho (Atalho F9)
  const handleClearCart = useCallback(() => {
    if (cartItems.length === 0) return
    setCartItems([])
    toast.info("Comanda reiniciada.")
  }, [cartItems.length])

  // Abrir Modal de Sangria ou Suprimento
  const handleOpenCashMovement = useCallback((type: CashMovementType = "sangria") => {
    setCashMovementType(type)
    setCashMovementModalOpen(true)
  }, [])

  // Confirmar Movimentação de Gaveta
  const handleConfirmMovement = useCallback((record: CashMovementRecord) => {
    setRegisterStatus((prev) => ({
      ...prev,
      currentCashInDrawer:
        record.type === "sangria"
          ? prev.currentCashInDrawer - record.amount
          : prev.currentCashInDrawer + record.amount,
    }))
  }, [])

  // Concluir Pagamento
  const handlePaymentComplete = useCallback((splits: PaymentSplit[]) => {
    setCompletedSplits(splits)

    // Atualiza saldo na gaveta caso tenha dinheiro
    const cashSplit = splits.find((s) => s.method === "cash")
    if (cashSplit) {
      setRegisterStatus((prev) => ({
        ...prev,
        currentCashInDrawer: prev.currentCashInDrawer + cashSplit.amount,
        nextNfceNumber: prev.nextNfceNumber + 1,
      }))
    } else {
      setRegisterStatus((prev) => ({
        ...prev,
        nextNfceNumber: prev.nextNfceNumber + 1,
      }))
    }

    // Abre o cupom térmico emitido
    setReceiptModalOpen(true)
  }, [])

  // Iniciar Próxima Venda
  const handleNewSale = useCallback(() => {
    setCartItems([])
    setCustomer(null)
    setGlobalDiscount(0)
    setCompletedSplits([])
    const nextSaleCode = String(registerStatus.nextNfceNumber).padStart(6, "0")
    setSaleNumber(nextSaleCode)
  }, [registerStatus.nextNfceNumber])

  const totalCartItems = cartItems.reduce((acc, i) => acc + i.quantity, 0)

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)] max-h-[calc(100vh-4rem)] w-full overflow-hidden bg-background">
      {/* Topo Operacional com Status do Caixa */}
      <PDVHeader
        registerStatus={registerStatus}
        onOpenCashMovement={handleOpenCashMovement}
        onCloseRegister={() => setCloseRegisterModalOpen(true)}
      />

      {/* Seletor de Abas Móveis (Visível apenas em telas menores que lg) */}
      <div className="flex lg:hidden items-center justify-between border-b border-border/80 bg-muted/40 p-2 px-3">
        <div className="grid grid-cols-2 rounded-lg bg-background p-1 border border-border/60 shadow-xs w-full">
          <button
            type="button"
            onClick={() => setMobileTab("catalog")}
            className={cn(
              "py-1.5 text-xs font-semibold rounded-md transition-all",
              mobileTab === "catalog"
                ? "bg-primary text-primary-foreground shadow-xs"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            Catálogo ({initialProducts.length})
          </button>
          <button
            type="button"
            onClick={() => setMobileTab("cart")}
            className={cn(
              "py-1.5 text-xs font-semibold rounded-md transition-all flex items-center justify-center gap-1.5",
              mobileTab === "cart"
                ? "bg-primary text-primary-foreground shadow-xs"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <span>Carrinho</span>
            {totalCartItems > 0 && (
              <span
                className={cn(
                  "rounded-full px-1.5 py-0.2 text-[10px] font-bold font-mono",
                  mobileTab === "cart"
                    ? "bg-primary-foreground text-primary"
                    : "bg-primary text-primary-foreground"
                )}
              >
                {totalCartItems}
              </span>
            )}
          </button>
        </div>
      </div>

      {/* Área Principal de Trabalho (Split 2 Colunas em Desktop / Abas em Mobile) */}
      <main className="flex-1 grid grid-cols-1 lg:grid-cols-12 gap-3 p-3 overflow-hidden">
        {/* Coluna Esquerda (Catálogo & Leitor EAN) */}
        <section
          className={cn(
            "lg:col-span-7 xl:col-span-8 h-full overflow-hidden",
            mobileTab === "catalog" ? "flex flex-col" : "hidden lg:flex lg:flex-col"
          )}
        >
          <PDVProductCatalog
            products={initialProducts}
            onSelectProduct={handleSelectProduct}
            focusSearchTrigger={searchTrigger}
          />
        </section>

        {/* Coluna Direita (Comanda & Fechamento) */}
        <section
          className={cn(
            "lg:col-span-5 xl:col-span-4 h-full overflow-hidden",
            mobileTab === "cart" ? "flex flex-col" : "hidden lg:flex lg:flex-col"
          )}
        >
          <PDVCart
            saleNumber={saleNumber}
            items={cartItems}
            customer={customer}
            globalDiscount={globalDiscount}
            onUpdateQuantity={handleUpdateQuantity}
            onRemoveItem={handleRemoveItem}
            onClearCart={handleClearCart}
            onOpenCustomerModal={() => setCustomerModalOpen(true)}
            onOpenDiscountModal={() => {
              const disc = prompt("Informe o valor do desconto em R$:")
              if (disc) {
                const val = parseFloat(disc.replace(",", ".")) || 0
                setGlobalDiscount(val)
                toast.success(`Desconto de R$ ${val.toFixed(2)} aplicado na venda!`)
              }
            }}
            onFinalizeSale={() => setPaymentModalOpen(true)}
          />
        </section>
      </main>

      {/* Rodapé Fixo com Atalhos de Teclado F1..F12 */}
      <PDVHotkeysFooter
        onSearchProduct={() => setSearchTrigger(Date.now())}
        onAddCustomer={() => setCustomerModalOpen(true)}
        onApplyDiscount={() => {
          const disc = prompt("Informe o valor do desconto em R$:")
          if (disc) {
            const val = parseFloat(disc.replace(",", ".")) || 0
            setGlobalDiscount(val)
            toast.success(`Desconto de R$ ${val.toFixed(2)} aplicado!`)
          }
        }}
        onCashMovement={() => handleOpenCashMovement("sangria")}
        onCancelLastItem={handleCancelLastItem}
        onClearCart={handleClearCart}
        onFinalizeSale={() => setPaymentModalOpen(true)}
        canFinalize={cartItems.length > 0}
      />

      {/* ============================================================ */}
      {/* MODAIS DO PDV                                                */}
      {/* ============================================================ */}
      {/* Modal de Pagamento Multi-Método */}
      <PDVPaymentModal
        open={paymentModalOpen}
        onOpenChange={setPaymentModalOpen}
        totalAmount={finalTotal}
        customer={customer}
        onPaymentComplete={handlePaymentComplete}
      />

      {/* Modal de Sangria e Suprimento */}
      <PDVCashMovementModal
        open={cashMovementModalOpen}
        onOpenChange={setCashMovementModalOpen}
        initialType={cashMovementType}
        currentDrawerCash={registerStatus.currentCashInDrawer}
        operatorName={registerStatus.operatorName}
        onConfirmMovement={handleConfirmMovement}
      />

      {/* Modal de CPF na Nota */}
      <PDVCustomerModal
        open={customerModalOpen}
        onOpenChange={setCustomerModalOpen}
        currentCustomer={customer}
        onSaveCustomer={setCustomer}
      />

      {/* Modal de Fechamento de Caixa */}
      <PDVCloseRegisterModal
        open={closeRegisterModalOpen}
        onOpenChange={setCloseRegisterModalOpen}
        status={registerStatus}
        totalSalesCash={330.5}
        totalSalesCard={540.0}
        totalSalesPix={210.0}
        onConfirmClose={() => {
          setCartItems([])
          setCustomer(null)
          toast.success("Caixa encerrado com sucesso!")
        }}
      />

      {/* Modal de Cupom Térmico NFC-e */}
      <PDVReceiptModal
        open={receiptModalOpen}
        onOpenChange={setReceiptModalOpen}
        saleNumber={saleNumber}
        items={cartItems}
        splits={completedSplits}
        customer={customer}
        nfceNumber={registerStatus.nextNfceNumber}
        series={registerStatus.nfceSeries}
        onNewSale={handleNewSale}
      />
    </div>
  )
}

