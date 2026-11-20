import { useState } from "react"
import { CreditCard } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/shadcn/ui/dialog"
import { InteractiveCreditCard } from "./interactive-credit-card"
import { CreditCardForm } from "./credit-card-form"
import {
  type CreditCardData,
  detectCardBrand,
} from "./credit-card-types"

export interface AddCardDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onAddCard: (card: CreditCardData) => Promise<void> | void
}

export function AddCardDialog({
  open,
  onOpenChange,
  onAddCard,
}: AddCardDialogProps) {
  const [liveCard, setLiveCard] = useState<CreditCardData>({
    number: "",
    holderName: "",
    expiry: "",
    cvv: "",
    nickname: "",
    isDefault: true,
    theme: "midnight",
  })
  const [isFlipped, setIsFlipped] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleFieldFocus = (field: "number" | "holder" | "expiry" | "cvv" | "other") => {
    setIsFlipped(field === "cvv")
  }

  const handleSubmit = async (cardData: CreditCardData) => {
    setIsSubmitting(true)
    try {
      await onAddCard(cardData)
      onOpenChange(false)
      // Reseta estado
      setLiveCard({
        number: "",
        holderName: "",
        expiry: "",
        cvv: "",
        nickname: "",
        isDefault: true,
        theme: "midnight",
      })
      setIsFlipped(false)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[560px] max-h-[92vh] overflow-y-auto overscroll-contain p-5 sm:p-6">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <CreditCard className="h-4 w-4" />
            </div>
            <div>
              <DialogTitle className="text-base font-bold">
                Cadastrar Novo Cartão
              </DialogTitle>
              <DialogDescription className="text-xs">
                Adicione um cartão de crédito para pagamentos recorrentes e assinaturas.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-6 py-2">
          {/* Cartão 3D Interativo no topo */}
          <div className="py-2">
            <InteractiveCreditCard
              number={liveCard.number}
              holderName={liveCard.holderName}
              expiry={liveCard.expiry}
              cvv={liveCard.cvv}
              isFlipped={isFlipped}
              theme={liveCard.theme}
              brand={detectCardBrand(liveCard.number)}
            />
          </div>

          {/* Formulário de Cadastro */}
          <CreditCardForm
            onSubmit={handleSubmit}
            onFieldFocus={handleFieldFocus}
            onCardChange={(data) => setLiveCard(data)}
            isLoading={isSubmitting}
            submitButtonText="Salvar e Validar Cartão"
          />
        </div>
      </DialogContent>
    </Dialog>
  )
}
