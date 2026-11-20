import { useState } from "react"
import type { Meta, StoryObj } from "@storybook/react"
import { InteractiveCreditCard } from "./interactive-credit-card"
import { CreditCardForm } from "./credit-card-form"
import { AddCardDialog } from "./add-card-dialog"
import { CardsWalletView } from "./cards-wallet-view"
import { Button } from "@/components/shadcn/ui/button"
import { MOCK_SAVED_CARDS, type CreditCardData } from "./credit-card-types"

const meta: Meta<typeof InteractiveCreditCard> = {
  title: "Shadcn/Finance/CreditCard",
  component: InteractiveCreditCard,
  parameters: {
    layout: "centered",
  },
}

export default meta

/**
 * Cartão 3D Interativo Físico com virada de frente e verso.
 */
function StandaloneCardDemo() {
  const [isFlipped, setIsFlipped] = useState(false)
  return (
    <div className="space-y-4 text-center">
      <InteractiveCreditCard
        number="5502 0912 3456 7890"
        holderName="JOAO P SILVA"
        expiry="08/29"
        cvv="789"
        isFlipped={isFlipped}
        theme="violet"
      />
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setIsFlipped(!isFlipped)}
        className="text-xs font-semibold"
      >
        {isFlipped ? "Ver Frente do Cartão" : "Ver Verso (Código CVV)"}
      </Button>
    </div>
  )
}

export const InteractiveCard3D: StoryObj = {
  render: () => <StandaloneCardDemo />,
}

/**
 * Cadastro de Cartão com Espelhamento em Tempo Real e Flip Automático no CVV.
 */
function LiveEnrollmentDemo() {
  const [card, setCard] = useState<CreditCardData>({
    number: "",
    holderName: "",
    expiry: "",
    cvv: "",
    nickname: "",
    isDefault: true,
    theme: "midnight",
  })
  const [isFlipped, setIsFlipped] = useState(false)

  return (
    <div className="w-full max-w-xl mx-auto rounded-2xl border border-border/80 bg-card p-6 shadow-md space-y-6">
      <div className="py-2">
        <InteractiveCreditCard
          number={card.number}
          holderName={card.holderName}
          expiry={card.expiry}
          cvv={card.cvv}
          isFlipped={isFlipped}
          theme={card.theme}
        />
      </div>

      <CreditCardForm
        onSubmit={(data) => {
          alert(`Cartão validado e salvo com sucesso: final ${data.number.slice(-4)}`)
        }}
        onFieldFocus={(field) => {
          setIsFlipped(field === "cvv")
        }}
        onCardChange={(data) => setCard(data)}
      />
    </div>
  )
}

export const CardEnrollmentWithLiveMirror: StoryObj = {
  render: () => <LiveEnrollmentDemo />,
}

/**
 * Modal Dialog para Adicionar Cartão com Cartão 3D e Formulário Integrados.
 */
function AddCardModalDemo() {
  const [open, setOpen] = useState(true)
  return (
    <div className="p-8">
      <Button onClick={() => setOpen(true)}>Abrir Modal de Cadastro de Cartão</Button>
      <AddCardDialog
        open={open}
        onOpenChange={setOpen}
        onAddCard={(card) => {
          alert(`Cartão adicionado: ${card.holderName} - final ${card.number.slice(-4)}`)
        }}
      />
    </div>
  )
}

export const AddCardModalInteractive: StoryObj = {
  render: () => <AddCardModalDemo />,
}

/**
 * Carteira Financeira Completa (Wallet Management).
 */
export const WalletManagementDeck: StoryObj = {
  render: () => (
    <div className="w-full max-w-4xl p-6">
      <CardsWalletView initialCards={MOCK_SAVED_CARDS} />
    </div>
  ),
}

/**
 * Modo Escuro (Dark Mode).
 */
export const DarkMode: StoryObj = {
  render: () => (
    <div className="dark bg-background text-foreground p-8 rounded-2xl w-full max-w-4xl">
      <CardsWalletView initialCards={MOCK_SAVED_CARDS} />
    </div>
  ),
}

