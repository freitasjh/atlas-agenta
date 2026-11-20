import { useRef, useEffect } from "react"
import { cn } from "@/lib/cn"

export interface InputOtpProps {
  length?: number
  value: string
  onChange: (value: string) => void
  onComplete?: (value: string) => void
  disabled?: boolean
  isInvalid?: boolean
  autoFocus?: boolean
  className?: string
}

export function InputOtp({
  length = 6,
  value,
  onChange,
  onComplete,
  disabled = false,
  isInvalid = false,
  autoFocus = true,
  className,
}: InputOtpProps) {
  const inputRefs = useRef<(HTMLInputElement | null)[]>([])

  // Normaliza os valores em array de caracteres
  const digits = Array.from({ length }, (_, i) => value[i] || "")

  useEffect(() => {
    if (autoFocus && inputRefs.current[0] && !disabled) {
      inputRefs.current[0].focus()
    }
  }, [autoFocus, disabled])

  const handleKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (disabled) return

    if (e.key === "Backspace") {
      e.preventDefault()
      if (digits[index]) {
        // Limpa o caractere atual
        const newDigits = [...digits]
        newDigits[index] = ""
        const newValue = newDigits.join("")
        onChange(newValue)
      } else if (index > 0) {
        // Se já está vazio, volta para o anterior e limpa
        const newDigits = [...digits]
        newDigits[index - 1] = ""
        const newValue = newDigits.join("")
        onChange(newValue)
        inputRefs.current[index - 1]?.focus()
      }
      return
    }

    if (e.key === "ArrowLeft" && index > 0) {
      e.preventDefault()
      inputRefs.current[index - 1]?.focus()
      return
    }

    if (e.key === "ArrowRight" && index < length - 1) {
      e.preventDefault()
      inputRefs.current[index + 1]?.focus()
      return
    }
  }

  const handleChange = (index: number, e: React.ChangeEvent<HTMLInputElement>) => {
    if (disabled) return
    const inputValue = e.target.value

    // Pega apenas o último caractere numérico se múltiplos foram digitados
    const numericChars = inputValue.replace(/\D/g, "")
    if (!numericChars) {
      const newDigits = [...digits]
      newDigits[index] = ""
      onChange(newDigits.join(""))
      return
    }

    const char = numericChars.slice(-1)
    const newDigits = [...digits]
    newDigits[index] = char
    const newValue = newDigits.join("")
    onChange(newValue)

    // Se completou a string de código
    if (newValue.length === length && onComplete) {
      onComplete(newValue)
    }

    // Avança o foco se houver próximo campo
    if (index < length - 1) {
      inputRefs.current[index + 1]?.focus()
    }
  }

  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    if (disabled) return
    e.preventDefault()
    const pastedData = e.clipboardData.getData("text/plain").trim()
    const numericOnly = pastedData.replace(/\D/g, "").slice(0, length)

    if (numericOnly) {
      onChange(numericOnly)
      if (numericOnly.length === length && onComplete) {
        onComplete(numericOnly)
      }
      // Foca no último campo preenchido ou no próximo vazio
      const targetIndex = Math.min(numericOnly.length, length - 1)
      inputRefs.current[targetIndex]?.focus()
    }
  }

  const midPoint = Math.floor(length / 2)

  return (
    <div className={cn("flex items-center justify-center gap-1.5 sm:gap-2", className)}>
      {Array.from({ length }).map((_, index) => {
        const isMiddleSeparator = length > 4 && index === midPoint

        return (
          <div key={index} className="flex items-center">
            {isMiddleSeparator && (
              <span className="mx-1 text-muted-foreground/60 select-none font-bold text-sm">
                –
              </span>
            )}
            <input
              ref={(el) => {
                inputRefs.current[index] = el
              }}
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              autoComplete="one-time-code"
              maxLength={1}
              value={digits[index]}
              onChange={(e) => handleChange(index, e)}
              onKeyDown={(e) => handleKeyDown(index, e)}
              onPaste={handlePaste}
              onFocus={(e) => e.target.select()}
              disabled={disabled}
              aria-label={`Dígito ${index + 1} de ${length}`}
              className={cn(
                "h-11 w-9 sm:h-12 sm:w-11 rounded-lg border text-center font-mono text-lg font-bold transition-all outline-none",
                "bg-background text-foreground shadow-xs select-none",
                "focus:border-primary focus:ring-2 focus:ring-primary/20",
                isInvalid
                  ? "border-destructive text-destructive focus:border-destructive focus:ring-destructive/20 animate-shake"
                  : "border-input hover:border-border/90",
                disabled && "cursor-not-allowed opacity-50 bg-muted/40"
              )}
            />
          </div>
        )
      })}
    </div>
  )
}

