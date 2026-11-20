import { Check } from "lucide-react"
import { cn } from "@/lib/cn"

interface SignupStepperProps {
  currentStep: 1 | 2 | 3
  className?: string
}

export function SignupStepper({ currentStep, className }: SignupStepperProps) {
  const steps = [
    { number: 1, label: "Conta" },
    { number: 2, label: "Workspace" },
    { number: 3, label: "Equipe" },
  ]

  return (
    <div className={cn("w-full py-2", className)}>
      <div className="flex items-center justify-between">
        {steps.map((step, idx) => {
          const isCompleted = currentStep > step.number
          const isCurrent = currentStep === step.number

          return (
            <div key={step.number} className="flex flex-1 items-center">
              <div className="flex flex-col items-center">
                <div
                  className={cn(
                    "flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold transition-all shadow-xs",
                    isCompleted
                      ? "bg-primary text-primary-foreground"
                      : isCurrent
                      ? "border-2 border-primary bg-background text-primary"
                      : "border border-border/80 bg-muted text-muted-foreground"
                  )}
                >
                  {isCompleted ? <Check className="h-3.5 w-3.5" /> : step.number}
                </div>
                <span
                  className={cn(
                    "mt-1 text-[11px] font-semibold transition-colors",
                    isCurrent
                      ? "text-foreground font-bold"
                      : isCompleted
                      ? "text-foreground/80"
                      : "text-muted-foreground"
                  )}
                >
                  {step.label}
                </span>
              </div>

              {idx < steps.length - 1 && (
                <div
                  className={cn(
                    "h-0.5 flex-1 mx-2 -mt-4 transition-colors",
                    currentStep > step.number ? "bg-primary" : "bg-border/60"
                  )}
                />
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

