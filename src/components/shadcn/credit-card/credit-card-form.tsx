import { useState } from "react"
import { ShieldCheck, Check, CreditCard } from "lucide-react"
import { Button } from "@/components/shadcn/ui/button"
import { Input } from "@/components/shadcn/ui/input"
import { Label } from "@/components/shadcn/ui/label"
import { Checkbox } from "@/components/shadcn/ui/checkbox"
import { cn } from "@/lib/cn"
import {
  formatCardNumber,
  formatExpiry,
  validateLuhn,
  isExpiryValid,
  detectCardBrand,
  type CreditCardData,
  type CardTheme,
} from "./credit-card-types"

export interface CreditCardFormProps {
  initialValues?: Partial<CreditCardData>
  onSubmit: (cardData: CreditCardData) => void
  onFieldFocus?: (fieldName: "number" | "holder" | "expiry" | "cvv" | "other") => void
  onCardChange?: (data: CreditCardData) => void
  submitButtonText?: string
  isLoading?: boolean
  className?: string
}

export function CreditCardForm({
  initialValues,
  onSubmit,
  onFieldFocus,
  onCardChange,
  submitButtonText = "Salvar Cartão de Crédito",
  isLoading = false,
  className,
}: CreditCardFormProps) {
  const [number, setNumber] = useState(initialValues?.number || "")
  const [holderName, setHolderName] = useState(initialValues?.holderName || "")
  const [expiry, setExpiry] = useState(initialValues?.expiry || "")
  const [cvv, setCvv] = useState(initialValues?.cvv || "")
  const [nickname, setNickname] = useState(initialValues?.nickname || "")
  const [isDefault, setIsDefault] = useState(initialValues?.isDefault ?? true)
  const [theme, setTheme] = useState<CardTheme>(initialValues?.theme || "midnight")

  // Notifica o pai quando os dados mudam para espelhar no cartão 3D
  const notifyChange = (updated: Partial<CreditCardData>) => {
    if (!onCardChange) return
    onCardChange({
      number: updated.number ?? number,
      holderName: updated.holderName ?? holderName,
      expiry: updated.expiry ?? expiry,
      cvv: updated.cvv ?? cvv,
      nickname: updated.nickname ?? nickname,
      isDefault: updated.isDefault ?? isDefault,
      theme: updated.theme ?? theme,
    })
  }

  // Handlers de inputs
  const handleNumberChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const formatted = formatCardNumber(e.target.value)
    setNumber(formatted)
    notifyChange({ number: formatted })
  }

  const handleHolderNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    // Apenas letras, espaços e pontos
    const upper = e.target.value.toUpperCase().replace(/[^A-Z\s.]/g, "").slice(0, 26)
    setHolderName(upper)
    notifyChange({ holderName: upper })
  }

  const handleExpiryChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const formatted = formatExpiry(e.target.value)
    setExpiry(formatted)
    notifyChange({ expiry: formatted })
  }

  const handleCvvChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const brand = detectCardBrand(number)
    const maxDigits = brand === "amex" ? 4 : 3
    const clean = e.target.value.replace(/\D/g, "").slice(0, maxDigits)
    setCvv(clean)
    notifyChange({ cvv: clean })
  }

  const handleThemeChange = (selectedTheme: CardTheme) => {
    setTheme(selectedTheme)
    notifyChange({ theme: selectedTheme })
  }

  // Validação
  const cleanNumber = number.replace(/\D/g, "")
  const isNumberComplete = cleanNumber.length >= 13 && cleanNumber.length <= 16
  const isLuhnValid = isNumberComplete && validateLuhn(cleanNumber)
  const isDateValid = isExpiryValid(expiry)
  const isCvvValid = cvv.length >= 3
  const isHolderValid = holderName.trim().length >= 3

  const isFormValid = isLuhnValid && isDateValid && isCvvValid && isHolderValid

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!isFormValid || isLoading) return
    onSubmit({
      number: cleanNumber,
      holderName: holderName.trim(),
      expiry,
      cvv,
      nickname: nickname.trim() || undefined,
      isDefault,
      theme,
    })
  }

  const themesList: { id: CardTheme; label: string; bg: string }[] = [
    { id: "midnight", label: "Midnight", bg: "bg-neutral-900 border-neutral-700" },
    { id: "emerald", label: "Emerald", bg: "bg-emerald-900 border-emerald-700" },
    { id: "violet", label: "Violet", bg: "bg-purple-900 border-purple-700" },
    { id: "platinum", label: "Platinum", bg: "bg-slate-600 border-slate-400" },
    { id: "rose_gold", label: "Rose Gold", bg: "bg-rose-900 border-rose-700" },
  ]

  return (
    <form onSubmit={handleSubmit} className={cn("space-y-4", className)}>
      {/* Seletor de Tema do Cartão */}
      <div className="space-y-1.5">
        <Label className="text-xs font-semibold flex items-center justify-between">
          <span>Estilo e Cor do Cartão</span>
          <span className="text-[10px] font-normal text-muted-foreground capitalize">
            {theme}
          </span>
        </Label>
        <div className="flex items-center gap-2">
          {themesList.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => handleThemeChange(t.id)}
              className={cn(
                "h-7 w-7 rounded-full border-2 transition-all cursor-pointer flex items-center justify-center shadow-xs",
                t.bg,
                theme === t.id
                  ? "ring-2 ring-primary ring-offset-2 ring-offset-background scale-110"
                  : "opacity-80 hover:opacity-100"
              )}
              aria-label={`Tema ${t.label}`}
            >
              {theme === t.id && <Check className="h-3.5 w-3.5 text-white" />}
            </button>
          ))}
        </div>
      </div>

      {/* Número do Cartão */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <Label htmlFor="card-number" className="text-xs font-semibold">
            Número do Cartão
          </Label>
          {cleanNumber.length >= 13 && (
            <span
              className={cn(
                "text-[10px] font-bold",
                isLuhnValid ? "text-emerald-500" : "text-destructive"
              )}
            >
              {isLuhnValid ? "Número válido" : "Número inválido"}
            </span>
          )}
        </div>
        <div className="relative">
          <Input
            id="card-number"
            type="text"
            inputMode="numeric"
            autoComplete="cc-number"
            placeholder="0000 0000 0000 0000"
            value={number}
            onChange={handleNumberChange}
            onFocus={() => onFieldFocus?.("number")}
            required
            className="text-xs h-10 w-full pl-9 font-mono font-medium tracking-wider"
          />
          <CreditCard className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        </div>
      </div>

      {/* Nome no Cartão */}
      <div className="space-y-1.5">
        <Label htmlFor="card-holder" className="text-xs font-semibold">
          Nome Impresso no Cartão
        </Label>
        <Input
          id="card-holder"
          type="text"
          autoComplete="cc-name"
          placeholder="Ex: JOAO SILVA"
          value={holderName}
          onChange={handleHolderNameChange}
          onFocus={() => onFieldFocus?.("holder")}
          required
          className="text-xs h-10 w-full uppercase font-mono"
        />
      </div>

      {/* Validade e CVV em 2 colunas simétricas */}
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="card-expiry" className="text-xs font-semibold">
            Validade (MM/AA)
          </Label>
          <Input
            id="card-expiry"
            type="text"
            inputMode="numeric"
            autoComplete="cc-exp"
            placeholder="12/29"
            maxLength={5}
            value={expiry}
            onChange={handleExpiryChange}
            onFocus={() => onFieldFocus?.("expiry")}
            required
            className={cn(
              "text-xs h-10 w-full text-center font-mono",
              expiry.length === 5 && !isDateValid && "border-destructive text-destructive"
            )}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="card-cvv" className="text-xs font-semibold">
            Código CVV / CVC
          </Label>
          <Input
            id="card-cvv"
            type="text"
            inputMode="numeric"
            autoComplete="cc-csc"
            placeholder="123"
            maxLength={4}
            value={cvv}
            onChange={handleCvvChange}
            onFocus={() => onFieldFocus?.("cvv")}
            required
            className="text-xs h-10 w-full text-center font-mono tracking-widest"
          />
        </div>
      </div>

      {/* Apelido do Cartão (Opcional) */}
      <div className="space-y-1.5">
        <Label htmlFor="card-nickname" className="text-xs font-semibold flex items-center justify-between">
          <span>Apelido do Cartão (Opcional)</span>
          <span className="text-[10px] text-muted-foreground">Ex: Pessoal, Corporativo</span>
        </Label>
        <Input
          id="card-nickname"
          type="text"
          placeholder="Ex: Cartão Nubank Principal"
          value={nickname}
          onChange={(e) => {
            setNickname(e.target.value)
            notifyChange({ nickname: e.target.value })
          }}
          onFocus={() => onFieldFocus?.("other")}
          className="text-xs h-10 w-full"
        />
      </div>

      {/* Checkbox de Cartão Padrão */}
      <div className="flex items-center space-x-2 pt-1 border-t border-border/70">
        <Checkbox
          id="card-default"
          checked={isDefault}
          onCheckedChange={(checked) => {
            setIsDefault(Boolean(checked))
            notifyChange({ isDefault: Boolean(checked) })
          }}
        />
        <label
          htmlFor="card-default"
          className="text-xs text-muted-foreground font-medium cursor-pointer select-none"
        >
          Definir como cartão preferencial para pagamentos futuros
        </label>
      </div>

      {/* Aviso de Segurança PCI DSS */}
      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground pt-1">
        <ShieldCheck className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
        <span>Seus dados são criptografados de ponta a ponta em conformidade com PCI-DSS Nível 1.</span>
      </div>

      {/* Botão de Submissão */}
      <Button
        type="submit"
        disabled={!isFormValid || isLoading}
        className="w-full h-10 text-xs font-semibold shadow-xs gap-1.5 mt-2"
      >
        <ShieldCheck className="h-4 w-4" />
        {isLoading ? "Processando e Tokenizando..." : submitButtonText}
      </Button>
    </form>
  )
}
