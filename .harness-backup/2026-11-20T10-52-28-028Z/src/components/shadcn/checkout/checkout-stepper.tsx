"use client"

import { Check } from "lucide-react"
import { type CheckoutStep } from "./checkout-types"

interface CheckoutStepperProps {
  currentStep: CheckoutStep
  onStepClick?: (step: CheckoutStep) => void
}

const STEPS = [
  { step: 1 as CheckoutStep, title: "Endereço", description: "Entrega e cobrança" },
  { step: 2 as CheckoutStep, title: "Pagamento", description: "Cartão, Pix ou Boleto" },
  { step: 3 as CheckoutStep, title: "Revisão", description: "Confirmação do pedido" },
]

export function CheckoutStepper({ currentStep, onStepClick }: CheckoutStepperProps) {
  // Se já concluiu (passo 4), todos aparecem como concluídos
  const isFinished = currentStep === 4

  return (
    <nav aria-label="Progresso do checkout" className="w-full">
      <ol className="flex items-center justify-between gap-2 sm:gap-4">
        {STEPS.map((s, index) => {
          const isCompleted = isFinished || currentStep > s.step
          const isActive = !isFinished && currentStep === s.step
          const isClickable = Boolean(onStepClick) && (isCompleted || isActive)

          return (
            <li
              key={s.step}
              className={`flex flex-1 items-center ${
                index < STEPS.length - 1 ? "after:h-0.5 after:flex-1 after:mx-2 after:bg-border/70" : ""
              } ${isCompleted ? "after:bg-primary" : ""}`}
            >
              <button
                type="button"
                disabled={!isClickable}
                onClick={() => isClickable && onStepClick?.(s.step)}
                className={`group flex items-center gap-2.5 text-left transition-colors ${
                  isClickable ? "cursor-pointer" : "cursor-default"
                }`}
              >
                {/* Círculo do Passo */}
                <div
                  className={`flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-bold transition-all ${
                    isCompleted
                      ? "bg-primary text-primary-foreground shadow-xs"
                      : isActive
                        ? "border-2 border-primary bg-background text-primary ring-4 ring-primary/15"
                        : "border border-border/80 bg-muted/50 text-muted-foreground"
                  }`}
                >
                  {isCompleted ? <Check className="size-4 stroke-[2.5]" /> : s.step}
                </div>

                {/* Textos */}
                <div className="hidden flex-col sm:flex">
                  <span
                    className={`text-xs font-semibold leading-tight ${
                      isActive || isCompleted
                        ? "text-foreground"
                        : "text-muted-foreground"
                    }`}
                  >
                    {s.title}
                  </span>
                  <span className="text-[11px] text-muted-foreground/80 leading-tight">
                    {s.description}
                  </span>
                </div>
              </button>
            </li>
          )
        })}
      </ol>
    </nav>
  )
}

