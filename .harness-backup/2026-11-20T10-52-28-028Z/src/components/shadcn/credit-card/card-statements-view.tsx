import { useState, useMemo } from "react"
import { CreditCard, Wallet, Receipt } from "lucide-react"
import { PillToggle } from "@/components/shadcn/ui/pill-toggle"
import { MonthYearPicker } from "@/components/shadcn/ui/month-year-picker"
import { CardSelectorBar } from "./card-selector-bar"
import { CardInvoiceHeader } from "./card-invoice-header"
import { InvoiceMonthTabs } from "./invoice-month-tabs"
import { CardExpensesTable } from "./card-expenses-table"
import { PayInvoiceDialog } from "./pay-invoice-dialog"
import { AddCardDialog } from "./add-card-dialog"
import { CardsWalletView } from "./cards-wallet-view"
import {
  MOCK_CARDS_WITH_INVOICES,
  MOCK_CARD_EXPENSES,
  type CardWithInvoices,
} from "./statement-types"
import type { CreditCardData } from "./credit-card-types"
import { toast } from "sonner"

export interface CardStatementsViewProps {
  initialCards?: CardWithInvoices[]
  initialViewMode?: "statements" | "wallet"
}

export function CardStatementsView({
  initialCards = MOCK_CARDS_WITH_INVOICES,
  initialViewMode = "statements",
}: CardStatementsViewProps) {
  const [cards, setCards] = useState<CardWithInvoices[]>(initialCards)
  const [selectedCardId, setSelectedCardId] = useState<string>("")
  const [viewMode, setViewMode] = useState<"statements" | "wallet">(initialViewMode)

  // Modais
  const [addCardModalOpen, setAddCardModalOpen] = useState(false)
  const [payInvoiceModalOpen, setPayInvoiceModalOpen] = useState(false)

  // Total consolidado de todas as faturas ativas
  const totalConsolidatedInvoicesAmount = useMemo(() => {
    return cards.reduce((sum, c) => {
      const activeInv =
        c.invoices.find((inv) => inv.status === "closed" || inv.status === "open") ||
        c.invoices[0]
      return sum + (activeInv?.totalAmount || 0)
    }, 0)
  }, [cards])

  // Limites consolidados
  const totalConsolidatedLimits = useMemo(() => {
    return cards.reduce(
      (acc, c) => ({
        totalLimit: acc.totalLimit + c.limits.totalLimit,
        usedLimit: acc.usedLimit + c.limits.usedLimit,
        availableLimit: acc.availableLimit + c.limits.availableLimit,
      }),
      { totalLimit: 0, usedLimit: 0, availableLimit: 0 }
    )
  }, [cards])

  // Objeto de cartão consolidado para quando selectedCardId === ""
  const consolidatedCard: CardWithInvoices = useMemo(
    () => ({
      id: "",
      nickname: "Visão Consolidada de Cartões",
      brand: "mastercard",
      last4: "Todos",
      holderName: "Atlas Corporativo",
      theme: "midnight",
      isDefault: false,
      limits: totalConsolidatedLimits,
      invoices: [
        {
          id: "inv-consolidated",
          cardId: "",
          period: "Novembro 2026",
          periodCode: "2026-11",
          status: "open",
          closingDate: "15/11/2026",
          dueDate: "22/11/2026",
          totalAmount: totalConsolidatedInvoicesAmount,
          minimumPayment: totalConsolidatedInvoicesAmount * 0.15,
          barcode: "34191.79001 01043.510047 91020.150008 5 95080000000000",
          pixCopyPaste: "00020126580014br.gov.bcb.pix0136123e4567-e89b-12d3-a456-4266141740005204000053039865400000.005802BR5915Atlas Pagamentos6009Sao Paulo62070503***6304ABCD",
        },
      ],
    }),
    [totalConsolidatedLimits, totalConsolidatedInvoicesAmount]
  )

  // Cartão selecionado
  const activeCard = useMemo(() => {
    if (selectedCardId === "") return consolidatedCard
    return cards.find((c) => c.id === selectedCardId) || cards[0]
  }, [cards, selectedCardId, consolidatedCard])

  // Fatura selecionada (por padrão a fatura com status "closed" ou "open", ou a última)
  const defaultInvoiceId = useMemo(() => {
    if (!activeCard) return ""
    const current =
      activeCard.invoices.find((inv) => inv.status === "closed" || inv.status === "open") ||
      activeCard.invoices[0]
    return current?.id || ""
  }, [activeCard])

  const [selectedInvoiceId, setSelectedInvoiceId] = useState<string>(defaultInvoiceId)

  // Fatura ativa
  const activeInvoice = useMemo(() => {
    if (!activeCard) return null
    return (
      activeCard.invoices.find((inv) => inv.id === selectedInvoiceId) ||
      activeCard.invoices[0] ||
      null
    )
  }, [activeCard, selectedInvoiceId])

  // Lançamentos filtrados por cartão e fatura
  const invoiceExpenses = useMemo(() => {
    if (!activeCard) return []
    if (selectedCardId === "") {
      return MOCK_CARD_EXPENSES
    }
    return MOCK_CARD_EXPENSES.filter((exp) => exp.cardId === activeCard.id)
  }, [activeCard, selectedCardId])

  const handleAddNewCard = (cardData: CreditCardData) => {
    const newCardEntry: CardWithInvoices = {
      id: `card-${Date.now()}`,
      nickname: cardData.nickname || `Cartão final ${cardData.number.slice(-4)}`,
      brand: "mastercard",
      last4: cardData.number.slice(-4),
      holderName: cardData.holderName,
      theme: cardData.theme || "midnight",
      isDefault: false,
      limits: {
        totalLimit: 15000,
        usedLimit: 0,
        availableLimit: 15000,
      },
      invoices: [
        {
          id: `inv-${Date.now()}`,
          cardId: `card-${Date.now()}`,
          period: "Novembro 2026",
          periodCode: "2026-11",
          status: "open",
          closingDate: "15/11/2026",
          dueDate: "22/11/2026",
          totalAmount: 0,
          minimumPayment: 0,
          barcode: "34191.79001 01043.510047 91020.150008 5 95080000000000",
          pixCopyPaste: "00020126580014br.gov.bcb.pix0136...",
        },
      ],
    }

    setCards([newCardEntry, ...cards])
    setSelectedCardId(newCardEntry.id)
    toast.success("Novo cartão cadastrado com sucesso!")
  }

  return (
    <div className="flex flex-col gap-6 px-4 lg:px-6 w-full">
      {/* Cabeçalho da Página com Alternador de Visão */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-border/70 pb-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-foreground sm:text-2xl flex items-center gap-2">
            <CreditCard className="h-6 w-6 text-primary" />
            Cartões de Crédito & Faturas
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Acompanhe limites, lançamentos em tempo real e emita o pagamento das faturas.
          </p>
        </div>

        {/* Alternador de Modo: Extrato da Fatura vs Carteira de Cartões */}
        <PillToggle
          value={viewMode}
          onChange={(val) => setViewMode(val as "statements" | "wallet")}
          size="sm"
          className="self-start sm:self-auto"
          aria-label="Modo de visualização dos cartões de crédito"
          options={[
            {
              value: "statements",
              label: "Faturas & Lançamentos",
              icon: <Receipt className="size-3.5" />,
            },
            {
              value: "wallet",
              label: "Gerenciar Cartões",
              badge: cards.length,
              icon: <Wallet className="size-3.5" />,
            },
          ]}
        />
      </div>

      {viewMode === "wallet" ? (
        /* Visualização de Carteira de Cartões */
        <CardsWalletView
          initialCards={cards.map((c) => ({
            id: c.id,
            brand: c.brand,
            last4: c.last4,
            holderName: c.holderName,
            expiryMonth: "12",
            expiryYear: "29",
            nickname: c.nickname,
            isDefault: c.isDefault,
            isExpired: false,
            theme: c.theme,
            createdAt: "2026-01-01",
          }))}
          onAddCard={handleAddNewCard}
        />
      ) : (
        /* Visualização de Extrato & Faturas do Cartão */
        <div className="space-y-6">
          {/* Seletor de Cartões em Carrossel com Botão Fixo no Início */}
          <CardSelectorBar
            cards={cards}
            selectedCardId={selectedCardId}
            totalConsolidatedAmount={totalConsolidatedInvoicesAmount}
            onSelectCard={(id) => {
              setSelectedCardId(id)
              if (id === "") {
                setSelectedInvoiceId("inv-consolidated")
              } else {
                const card = cards.find((c) => c.id === id)
                if (card && card.invoices[0]) {
                  setSelectedInvoiceId(card.invoices[0].id)
                }
              }
            }}
            onAddNewCard={() => setAddCardModalOpen(true)}
          />

          {/* Resumo da Fatura (The Verdict Row) */}
          {activeInvoice && activeCard && (
            <CardInvoiceHeader
              card={activeCard}
              invoice={activeInvoice}
              isConsolidated={selectedCardId === ""}
              onPayInvoice={() => setPayInvoiceModalOpen(true)}
              onExportStatement={() => {
                toast.info("Demonstrativo da fatura exportado com sucesso em PDF.")
              }}
            />
          )}

          {/* Abas e Filtro de Mês/Ano da Fatura */}
          {activeCard && activeCard.invoices.length > 0 && (
            <div className="space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-border/80 pb-3">
                <InvoiceMonthTabs
                  invoices={activeCard.invoices}
                  selectedInvoiceId={selectedInvoiceId}
                  onSelectInvoice={setSelectedInvoiceId}
                  className="border-b-0 pb-0"
                />

                <div className="shrink-0 self-start sm:self-auto">
                  <MonthYearPicker
                    defaultValue="2026-11"
                    size="sm"
                    onChange={(val) => {
                      const match = activeCard.invoices.find(
                        (inv) => inv.periodCode === val.isoString
                      )
                      if (match) {
                        setSelectedInvoiceId(match.id)
                        toast.info(`Fatura de ${val.label} selecionada.`)
                      } else {
                        toast.info(`Nenhuma fatura encontrada para ${val.label}.`)
                      }
                    }}
                  />
                </div>
              </div>

              {/* Tabela de Lançamentos */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-bold text-foreground">
                    Lançamentos da Fatura • {activeInvoice?.period}
                  </h3>
                  <span className="text-xs text-muted-foreground">
                    {invoiceExpenses.length} transações registradas
                  </span>
                </div>

                <CardExpensesTable
                  expenses={invoiceExpenses}
                  cardLast4={activeCard.last4}
                />
              </div>
            </div>
          )}

          {/* Modal de Pagamento da Fatura */}
          {activeInvoice && (
            <PayInvoiceDialog
              open={payInvoiceModalOpen}
              onOpenChange={setPayInvoiceModalOpen}
              invoice={activeInvoice}
            />
          )}

          {/* Modal de Cadastro de Novo Cartão */}
          <AddCardDialog
            open={addCardModalOpen}
            onOpenChange={setAddCardModalOpen}
            onAddCard={handleAddNewCard}
          />
        </div>
      )}
    </div>
  )
}
