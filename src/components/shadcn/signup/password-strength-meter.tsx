import { Check, Circle } from "lucide-react"
import { cn } from "@/lib/cn"
import { evaluatePasswordStrength } from "./signup-types"

interface PasswordStrengthMeterProps {
  password: string
  className?: string
}

export function PasswordStrengthMeter({
  password,
  className,
}: PasswordStrengthMeterProps) {
  if (!password) return null

  const result = evaluatePasswordStrength(password)

  // Cores por nível de força
  const getBarColor = (index: number) => {
    if (index >= result.score) return "bg-muted"
    if (result.score === 1) return "bg-destructive"
    if (result.score === 2) return "bg-amber-500"
    if (result.score === 3) return "bg-blue-500"
    return "bg-emerald-500"
  }

  const getTextColor = () => {
    if (result.score <= 1) return "text-destructive"
    if (result.score === 2) return "text-amber-500"
    if (result.score === 3) return "text-blue-500"
    return "text-emerald-500"
  }

  return (
    <div className={cn("space-y-2 pt-1", className)} aria-live="polite">
      {/* Barra segmentada de progresso */}
      <div className="flex items-center gap-1.5">
        {[0, 1, 2, 3].map((idx) => (
          <div
            key={idx}
            className={cn(
              "h-1.5 flex-1 rounded-full transition-colors duration-300",
              getBarColor(idx)
            )}
          />
        ))}
      </div>

      <div className="flex items-center justify-between text-[11px]">
        <span className="text-muted-foreground">Força da senha:</span>
        <span className={cn("font-bold", getTextColor())}>{result.label}</span>
      </div>

      {/* Checklist de requisitos dinâmicos */}
      <div className="space-y-1 pt-1 text-[11px]">
        <div
          className={cn(
            "flex items-center gap-1.5 transition-colors",
            result.hasMinLength ? "text-emerald-600 dark:text-emerald-400 font-medium" : "text-muted-foreground"
          )}
        >
          {result.hasMinLength ? (
            <Check className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
          ) : (
            <Circle className="h-2.5 w-2.5 mx-0.5 text-muted-foreground/60 shrink-0" />
          )}
          <span>Mínimo de 8 caracteres</span>
        </div>

        <div
          className={cn(
            "flex items-center gap-1.5 transition-colors",
            result.hasUppercase ? "text-emerald-600 dark:text-emerald-400 font-medium" : "text-muted-foreground"
          )}
        >
          {result.hasUppercase ? (
            <Check className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
          ) : (
            <Circle className="h-2.5 w-2.5 mx-0.5 text-muted-foreground/60 shrink-0" />
          )}
          <span>Pelo menos uma letra maiúscula</span>
        </div>

        <div
          className={cn(
            "flex items-center gap-1.5 transition-colors",
            result.hasNumberOrSymbol ? "text-emerald-600 dark:text-emerald-400 font-medium" : "text-muted-foreground"
          )}
        >
          {result.hasNumberOrSymbol ? (
            <Check className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
          ) : (
            <Circle className="h-2.5 w-2.5 mx-0.5 text-muted-foreground/60 shrink-0" />
          )}
          <span>Pelo menos um número ou símbolo especial</span>
        </div>
      </div>
    </div>
  )
}

